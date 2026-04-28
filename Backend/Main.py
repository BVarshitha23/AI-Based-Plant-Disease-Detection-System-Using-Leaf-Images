import io
import json
import os
import re
import threading
import time
import webbrowser

import cv2
import numpy as np
import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import img_to_array

from auth import get_current_user, router as auth_router, verify_admin
from config import (
    FRONTEND_DIR,
    IMG_SIZE,
    JSON_PATH,
    MODEL_PATH,
    TTA_STEPS,
    groq_client,
)
from database import get_db, init_db
from schemas import AIAdviceRequest, FeedbackRequest, TranslateRequest, WeatherAdviceRequest, CostSprayRequest, ChangePasswordRequest, ForgotPasswordRequest, ResetPasswordRequest, VerifyOTPRequest
from weather import get_weather, get_location_name, get_soil_info, get_sowing_context, get_date_context, build_context_prompt


# LOAD MODEL & CLASS LABELS
print("\n  Loading model...")
model = load_model(MODEL_PATH)
print("  Model loaded")

with open(JSON_PATH, "r") as f:
    class_indices: dict = json.load(f)

print(f"  {len(class_indices)} classes loaded\n")


#  ML HELPERS 
def format_label(label: str) -> str:
    return label.replace("___", " - ").replace("_", " ").title()


def load_raw_from_bytes(image_bytes: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image = image.resize(IMG_SIZE)
    return img_to_array(image)


def augment_and_preprocess(raw_arr: np.ndarray) -> np.ndarray:
    img  = raw_arr.copy()
    img += np.random.uniform(-10, 10)
    img  = np.clip(img, 0, 255)
    if np.random.rand() > 0.5:
        img = np.fliplr(img)
    img = np.expand_dims(img, axis=0)
    return preprocess_input(img)


def predict_with_tta(image_bytes: bytes) -> np.ndarray:
    raw_arr    = load_raw_from_bytes(image_bytes)
    base_input = preprocess_input(np.expand_dims(raw_arr.copy(), axis=0))
    base_pred: np.ndarray       = model.predict(base_input, verbose=0)[0]
    tta_preds: list[np.ndarray] = [base_pred]
    for _ in range(TTA_STEPS - 1):
        aug_pred: np.ndarray = model.predict(
            augment_and_preprocess(raw_arr), verbose=0
        )[0]
        tta_preds.append(aug_pred)
    return np.mean(tta_preds, axis=0)


def calculate_severity(image_bytes: bytes, predicted_label: str) -> dict:
    if "healthy" in predicted_label.lower():
        return {"severity_pct": 0.0, "stage": "Healthy", "urgency": "None"}

    nparr = np.frombuffer(image_bytes, np.uint8)
    img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return {"severity_pct": 0.0, "stage": "Unknown", "urgency": "Unknown"}

    img         = cv2.resize(img, (224, 224))
    hsv         = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask_brown1 = cv2.inRange(hsv, np.array([10, 40, 40]),  np.array([20, 255, 255]))
    mask_brown2 = cv2.inRange(hsv, np.array([20, 30, 30]),  np.array([35, 255, 200]))
    mask_dark   = cv2.inRange(hsv, np.array([0,  0,  0]),   np.array([180, 255, 60]))
    disease_mask = cv2.bitwise_or(cv2.bitwise_or(mask_brown1, mask_brown2), mask_dark)
    leaf_mask    = cv2.inRange(hsv, np.array([35, 40, 40]), np.array([90, 255, 255]))

    diseased_pixels = cv2.countNonZero(disease_mask)
    healthy_pixels  = cv2.countNonZero(leaf_mask)
    total_pixels    = diseased_pixels + healthy_pixels
    severity_pct    = (
        0.0 if total_pixels == 0
        else round((diseased_pixels / total_pixels) * 100, 2)
    )
    severity_pct = min(severity_pct, 95.0)

    if severity_pct < 25:
        stage, urgency = "Early",    "Low — monitor daily and apply preventive spray"
    elif severity_pct < 50:
        stage, urgency = "Moderate", "Medium — apply fungicide within 2-3 days"
    elif severity_pct < 75:
        stage, urgency = "Severe",   "High — apply treatment immediately today"
    else:
        stage, urgency = "Critical", "Immediate — treat now and consider isolating the plant"

    return {"severity_pct": severity_pct, "stage": stage, "urgency": urgency}


#  APP INIT 
app = FastAPI(title="Plant Disease Detection")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.include_router(auth_router)


@app.on_event("startup")
def startup() -> None:
    init_db()


# FRONTEND ROUTES 
@app.get("/")
def serve_login_page():
    return FileResponse(f"{FRONTEND_DIR}/login.html")

@app.get("/login")
def serve_login():
    return FileResponse(f"{FRONTEND_DIR}/login.html")

@app.get("/register")
def serve_register():
    return FileResponse(f"{FRONTEND_DIR}/register.html")

@app.get("/detect")
def serve_detect():
    return FileResponse(f"{FRONTEND_DIR}/detect.html")

@app.get("/history")
def serve_history_page():
    return FileResponse(f"{FRONTEND_DIR}/history.html")

@app.get("/admin")
def serve_admin():
    return FileResponse(f"{FRONTEND_DIR}/admin.html")

@app.get("/health")
def health_check():
    return {"status": "ok"}

# PREDICT ROUTE
@app.post("/predict")
async def predict(
    file:         UploadFile = File(...),
    current_user: dict       = Depends(get_current_user),
):
    image_bytes     = await file.read()
    predictions     = predict_with_tta(image_bytes)
    best_idx        = str(np.argmax(predictions))
    best_label      = class_indices.get(best_idx, "Unknown")
    confidence      = float(np.max(predictions))
    formatted_label = format_label(best_label)
    severity        = calculate_severity(image_bytes, best_label)

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO predictions
                (user_id, predicted_class, confidence, severity_pct, stage, urgency)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                current_user["id"],
                formatted_label,
                round(confidence * 100, 2),
                severity["severity_pct"],
                severity["stage"],
                severity["urgency"],
            ),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"  DB save error: {e}")
    finally:
        cur.close()
        conn.close()

    return {
        "predicted_class": formatted_label,
        "confidence":      round(confidence * 100, 2),
        "severity_pct":    severity["severity_pct"],
        "stage":           severity["stage"],
        "urgency":         severity["urgency"],
    }


#  GROQ AI ADVICE ROUTE
@app.post("/groq-advice")
async def groq_advice(
    body:         AIAdviceRequest,
    current_user: dict = Depends(get_current_user),
):
    if groq_client is None:
        raise HTTPException(status_code=503, detail="Groq API key not configured")

    is_healthy = "healthy" in body.predicted_class.lower()

    if is_healthy:
        prompt = f"""You are an expert agronomist assistant helping Indian farmers.

A plant disease detection system has scanned a plant leaf and found it is HEALTHY.
Plant: {body.predicted_class}
Confidence: {body.confidence}%

Respond ONLY with a JSON object (no markdown, no extra text) with these exact keys:
{{
  "summary": "One friendly sentence congratulating the farmer and encouraging continued care.",
  "what_is_this": "Brief 2-sentence explanation of what the healthy status means.",
  "immediate_actions": ["action1", "action2", "action3"],
  "prevention_tips": ["tip1", "tip2", "tip3"],
  "farmer_tip": "One practical tip specific to growing this crop well in India.",
  "risk_level": "None"
}}"""
    else:
        prompt = f"""You are an expert agronomist assistant helping Indian farmers.

A plant disease detection ML model has diagnosed the following:
- Disease: {body.predicted_class}
- Confidence: {body.confidence}%
- Severity: {body.severity_pct}% of leaf infected
- Stage: {body.stage}
- Urgency: {body.urgency}

Respond ONLY with a JSON object (no markdown, no extra text) with these exact keys:
{{
  "summary": "One urgent but calm sentence summarising the situation for a farmer.",
  "what_is_this": "2-sentence plain-language explanation of this disease: what it is and how it spreads.",
  "immediate_actions": ["Specific action 1 with dosage/timing", "Specific action 2", "Specific action 3"],
  "prevention_tips": ["Prevention tip 1 for next season", "Prevention tip 2", "Prevention tip 3"],
  "farmer_tip": "One local/practical tip relevant to Indian farming conditions.",
  "risk_level": "{body.stage}"
}}

Be specific, practical, and use simple language. Include specific fungicide/pesticide names where relevant."""

    raw_text = ""
    try:
        print(f"[Groq] Calling API for: {body.predicted_class}")

        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role":    "system",
                    "content": "You are an expert agronomist. Always respond with valid JSON only. "
                               "No markdown, no explanation, just the JSON object.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=1000,
            temperature=0.3,
        )

        raw_text = (response.choices[0].message.content or "").strip()
        print(f"[Groq] Raw response: {raw_text[:200]}")

        raw_text = re.sub(r"^```(?:json)?\s*\n?", "", raw_text)
        raw_text = re.sub(r"\n?```\s*$", "", raw_text).strip()

        advice = json.loads(raw_text)
        return {"success": True, "advice": advice, "model": "llama-3.1-8b-instant"}

    except json.JSONDecodeError as e:
        print(f"[Groq] JSON parse error: {e}\nRaw text: {raw_text}")
        return {
            "success": False,
            "advice":  {"summary": raw_text},
            "model":   "llama-3.1-8b-instant",
            "error":   f"JSON parse error: {str(e)}",
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[Groq] Exception: {type(e).__name__}: {str(e)}")
        if "rate_limit" in str(e).lower() or "429" in str(e):
            raise HTTPException(
                status_code=429,
                detail="AI quota exceeded. Please try again in a minute.",
            )
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")
    
#  WEATHER + LOCATION + SOIL + SEASON ADVICE 
@app.post("/weather-advice")
async def weather_advice(
    body:         WeatherAdviceRequest,
    current_user: dict = Depends(get_current_user),
):
    if groq_client is None:
        raise HTTPException(status_code=503, detail="Groq API key not configured")

    import asyncio

    # Fetch all live data in parallel
    weather, location, soil = await asyncio.gather(
        get_weather(body.latitude, body.longitude),
        get_location_name(body.latitude, body.longitude),
        get_soil_info(body.latitude, body.longitude),
    )

    # Sowing + date context — instant, no API
    sowing_ctx = get_sowing_context(body.sowing_date)
    date_ctx   = get_date_context()

    disease_info = {
        "predicted_class": body.predicted_class,
        "confidence":      body.confidence,
        "severity_pct":    body.severity_pct,
        "stage":           body.stage,
        "urgency":         body.urgency,
    }

    prompt = build_context_prompt(
        disease_info, weather, location, soil,
        body.soil_type, sowing_ctx, body.irrigation_method, date_ctx,
    )

    raw_text = ""
    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role":    "system",
                    "content": "You are an expert agronomist. Always respond with valid JSON only. "
                               "No markdown, no explanation, just the JSON object.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=1200,
            temperature=0.3,
        )
        raw_text = (response.choices[0].message.content or "").strip()
        raw_text = re.sub(r"^```(?:json)?\s*\n?", "", raw_text)
        raw_text = re.sub(r"\n?```\s*$", "", raw_text).strip()
        advice   = json.loads(raw_text)

        return {
            "success":  True,
            "advice":   advice,
            "context": {
                "weather":    weather,
                "location":   location,
                "soil":       soil,
                "sowing":     sowing_ctx,
                "date":       date_ctx,
                "soil_type":  body.soil_type,
                "irrigation": body.irrigation_method,
            },
            "model": "llama-3.1-8b-instant",
        }

    except json.JSONDecodeError as e:
        return {
            "success": False,
            "advice":  {"summary": raw_text},
            "error":   f"JSON parse error: {str(e)}",
        }
    except Exception as e:
        if "rate_limit" in str(e).lower() or "429" in str(e):
            raise HTTPException(status_code=429, detail="AI quota exceeded. Please try again in a minute.")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

@app.post("/groq-cost-spray")
async def groq_cost_spray(
    body:         CostSprayRequest,
    current_user: dict = Depends(get_current_user),
):
    if groq_client is None:
        raise HTTPException(status_code=503, detail="Groq API key not configured")
 
    is_healthy = "healthy" in body.predicted_class.lower()
    if is_healthy:
        return {
            "success": True,
            "cost": None,
            "spray": None,
        }
 
    # Build weather context string
    weather_ctx = ""
    if body.temperature_c is not None:
        weather_ctx = f"""
=== LIVE WEATHER AT FARMER'S LOCATION ===
Temperature   : {body.temperature_c}°C
Humidity      : {body.humidity_pct}%
3-Day Rain    : {body.rain_3day_mm} mm — {body.rain_forecast}
Location      : {body.location_city}, {body.location_state}
Soil Type     : {body.soil_type or 'Unknown'}
Sowing Date   : {body.sowing_date or 'Not provided'}"""
    else:
        weather_ctx = "Weather/location data not available — give general Indian farming advice."
 
    today = __import__('datetime').date.today()
 
    prompt = f"""You are an expert agronomist for Indian farmers. Given this plant disease detection:
 
Disease       : {body.predicted_class}
Confidence    : {body.confidence}%
Severity      : {body.severity_pct}% leaf infected
Stage         : {body.stage}
Urgency       : {body.urgency}
Today's Date  : {today.strftime('%d %B %Y')}
{weather_ctx}
 
Respond ONLY with a valid JSON object (no markdown, no extra text):
{{
  "cost": {{
    "product_name": "Exact Indian brand name + active ingredient (e.g. Dithane M-45 (Mancozeb 75% WP))",
    "dosage_rate": "exact dosage per litre of water (e.g. 2.5 g/L)",
    "sprays_needed": <integer: how many sprays based on severity>,
    "cost_per_acre_inr": <integer: realistic Indian market price per acre per spray in INR>,
    "labour_per_spray_inr": <integer: realistic daily labour cost in INR>,
    "total_low_inr": <integer: minimum total cost for all sprays + labour>,
    "total_high_inr": <integer: maximum total cost for all sprays + labour>,
    "alternative_product": "One cheaper alternative product available in Indian markets",
    "note": "One sentence: when to buy, any mixing advice, or where to get it in India"
  }},
  "spray": {{
    "weather_status": "safe_to_spray | delay_rain | light_rain_ok",
    "weather_message": "One sentence about current weather and spray safety — be specific about rain data if available",
    "delay_days": <integer: 0 if safe today, else number of days to wait>,
    "interval_days": <integer: days between sprays based on disease and severity>,
    "schedule": [
      {{
        "spray_number": 1,
        "date_offset_days": <integer: days from today for this spray>,
        "label": "Start Today | Delayed Start | Spray 2 | etc",
        "best_time": "Early morning 6–9 AM (avoid hot sun)",
        "notes": "Any specific note for this spray (e.g. add sticker, check rain before spraying)"
      }}
    ],
    "precautions": ["Precaution 1 specific to this disease", "Precaution 2", "Precaution 3"]
  }}
}}
 
Rules:
- spray schedule array must have exactly {{'sprays_needed'}} entries
- Use realistic Indian market prices (not too high, not too low)
- If rain > 10mm in 3 days, set delay_days = 2 and weather_status = "delay_rain"
- If rain 3-7mm, set weather_status = "light_rain_ok" 
- If rain < 3mm or no weather data, set weather_status = "safe_to_spray" and delay_days = 0
- Calculate date_offset_days as: delay_days + (spray_index * interval_days)
- Mention specific Indian fungicide/pesticide brand names
- All cost values must be realistic integers in Indian Rupees"""
 
    raw_text = ""
    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role":    "system",
                    "content": "You are an expert agronomist. Always respond with valid JSON only. "
                               "No markdown, no explanation, just the JSON object.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=1200,
            temperature=0.2,
        )
 
        raw_text = (response.choices[0].message.content or "").strip()
        raw_text = __import__('re').sub(r"^```(?:json)?\s*\n?", "", raw_text)
        raw_text = __import__('re').sub(r"\n?```\s*$", "", raw_text).strip()
        result   = __import__('json').loads(raw_text)
 
        return {
            "success": True,
            "cost":    result.get("cost"),
            "spray":   result.get("spray"),
        }
 
    except __import__('json').JSONDecodeError as e:
        return {"success": False, "error": f"JSON parse error: {str(e)}", "raw": raw_text}
    except Exception as e:
        if "rate_limit" in str(e).lower() or "429" in str(e):
            raise HTTPException(status_code=429, detail="AI quota exceeded. Please try again.")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

#  TRANSLATE ROUTE 
@app.post("/api/translate")
async def translate_result(
    body:         TranslateRequest,
    current_user: dict = Depends(get_current_user),
):
    if groq_client is None:
        raise HTTPException(status_code=503, detail="Groq not configured")

    lang_names = {"hi": "Hindi", "te": "Telugu", "ta": "Tamil", "kn": "Kannada"}
    lang_name  = lang_names.get(body.lang)
    if not lang_name:
        raise HTTPException(status_code=400, detail="Unsupported language")

    is_healthy = "healthy" in body.predicted_class.lower()

    if is_healthy:
        source = "Your plant is healthy! No disease detected. Continue regular care and monitor weekly."
    else:
        source = (
            f"Your plant has {body.predicted_class} at {body.stage.lower()} stage — "
            f"{body.severity_pct}% of the leaf is infected. "
            f"Follow the treatment steps shown immediately."
        )

    prompt = f"Translate this exactly to {lang_name}. Return ONLY the translated text, nothing else:\n\n{source}"

    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role":    "system",
                    "content": f"You are a translator. Translate to {lang_name} only. "
                               "Return only the translated text with no explanation.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=300,
            temperature=0.1,
        )
        translated = (response.choices[0].message.content or "").strip()
        return {"translated": translated, "lang": body.lang}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation error: {str(e)}")


#  HISTORY ROUTE
@app.get("/api/history")
def get_history(current_user: dict = Depends(get_current_user)):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, predicted_class, confidence, severity_pct, stage, urgency, created_at
            FROM predictions
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 500
            """,
            (current_user["id"],),
        )
        rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    records = []
    for row in rows:
        r = dict(row)
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
        records.append(r)

    return {"records": records}


# FEEDBACK ROUTE 
@app.post("/feedback", status_code=201)
def submit_feedback(
    body:         FeedbackRequest,
    current_user: dict = Depends(get_current_user),
):
    if body.rating < 1 or body.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be 1–5")
    if not body.category:
        raise HTTPException(status_code=400, detail="Category is required")

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO feedback (user_id, rating, category, message)
            VALUES (%s, %s, %s, %s)
            """,
            (
                current_user["id"],
                body.rating,
                body.category.strip(),
                body.message.strip()[:500],
            ),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    return {"message": "Feedback submitted successfully"}


# ADMIN ROUTES
@app.get("/admin/feedback")
def get_all_feedback(
    _admin: dict = Depends(verify_admin),
    limit:  int  = 500,
    offset: int  = 0,
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            SELECT f.id, f.rating, f.category, f.message,
                    f.created_at, u.username
            FROM feedback f
            LEFT JOIN users u ON f.user_id = u.id
            ORDER BY f.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    records = []
    for row in rows:
        r = dict(row)
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
        records.append(r)

    return {"feedback": records, "count": len(records)}


@app.get("/admin/users")
def get_all_users(
    _admin: dict = Depends(verify_admin),
    limit:  int  = 500,
    offset: int  = 0,
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, username, email, is_admin, created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    records = []
    for row in rows:
        r = dict(row)
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
        records.append(r)

    return {"users": records, "count": len(records)}


@app.get("/admin/detections")
def get_all_detections(
    _admin: dict = Depends(verify_admin),
    limit:  int  = 1000,
    offset: int  = 0,
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            SELECT p.id, p.user_id, p.predicted_class, p.confidence,
                   p.severity_pct, p.stage, p.urgency, p.created_at,
                   u.username
            FROM predictions p
            LEFT JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    records = []
    for row in rows:
        r = dict(row)
        if r.get("created_at"):
            r["created_at"] = r["created_at"].isoformat()
        records.append(r)

    return {"detections": records, "count": len(records)}


@app.patch("/admin/users/{user_id}/toggle-admin")
def toggle_admin(
    user_id: int,
    _admin:  dict = Depends(verify_admin),
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id, is_admin FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user       = dict(user)
        new_status = not user["is_admin"]
        cur.execute(
            "UPDATE users SET is_admin = %s WHERE id = %s",
            (new_status, user_id),
        )
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    return {
        "message":  f"User {'promoted to admin' if new_status else 'demoted to normal user'}",
        "user_id":  user_id,
        "is_admin": new_status,
    }

@app.delete("/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    _admin:  dict = Depends(verify_admin),
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE id = %s", (user_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        # delete child rows first (skip if you have ON DELETE CASCADE FKs)
        cur.execute("DELETE FROM predictions WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM feedback    WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM users       WHERE id      = %s", (user_id,))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    return {"message": "User deleted successfully"}


@app.delete("/admin/detections/{detection_id}")
def admin_delete_detection(
    detection_id: int,
    _admin:       dict = Depends(verify_admin),
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id FROM predictions WHERE id = %s", (detection_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Detection not found")

        cur.execute("DELETE FROM predictions WHERE id = %s", (detection_id,))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    return {"message": "Detection deleted successfully"}


@app.delete("/admin/feedback/{feedback_id}")
def admin_delete_feedback(
    feedback_id: int,
    _admin:      dict = Depends(verify_admin),
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id FROM feedback WHERE id = %s", (feedback_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Feedback not found")

        cur.execute("DELETE FROM feedback WHERE id = %s", (feedback_id,))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    return {"message": "Feedback deleted successfully"}



#  STATIC FILE FALLBACK
@app.get("/{filename:path}")
def serve_file(filename: str):
    filepath = os.path.join(FRONTEND_DIR, filename)
    if os.path.exists(filepath) and os.path.isfile(filepath):
        return FileResponse(filepath)
    return FileResponse(f"{FRONTEND_DIR}/login.html")


#  RUN
if __name__ == "__main__":
    def open_browser():
        time.sleep(2)
        webbrowser.open("http://localhost:8000/login.html")

    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)