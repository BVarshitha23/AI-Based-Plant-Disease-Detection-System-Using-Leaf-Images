from datetime import datetime, timedelta, timezone
from pathlib import Path
import bcrypt
import cv2
import io
import json
import jwt
import numpy as np
import os
import psycopg2
import threading
import time
import webbrowser
import re
import httpx
import smtplib
import random
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from psycopg2.extras import RealDictCursor
import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import img_to_array
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

#  CONFIG
MODEL_PATH   = r"D:\Custom_dataset\Output\mobilenetv2_unfreeze50_best.keras"
JSON_PATH    = r"D:\Custom_dataset\Output\class_labels.json"
IMG_SIZE     = (224, 224)
TTA_STEPS    = 5
FRONTEND_DIR = r"D:\fastapi practice\Frontend"

#  JWT CONFIG
SECRET_KEY = os.environ["SECRET_KEY"]
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set in .env — server cannot start")
ALGORITHM           = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(days=1)
bearer_scheme       = HTTPBearer(auto_error=False)

#  GROQ CONFIG 
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if GROQ_API_KEY:
    groq_client = Groq(api_key=GROQ_API_KEY)
    print("  Groq AI ready")
else:
    groq_client = None
    print("  GROQ_API_KEY not set — /groq-advice will return 503")

RECAPTCHA_SECRET = os.environ.get("RECAPTCHA_SECRET_KEY")

#  DB CONFIG 
DB_CONFIG = {
    "host":     os.environ.get("DB_HOST"),
    "port":     int(os.environ.get("DB_PORT", "5432")),
    "dbname":   os.environ.get("DB_NAME"),
    "user":     os.environ.get("DB_USER"),
    "password": os.environ.get("DB_PASSWORD"),
}

# In-memory OTP store {email: {otp, expires}}
otp_store: dict = {}

def send_otp_email(to_email: str, otp: str) -> None:
    gmail_user = os.environ["GMAIL_USER"]
    gmail_pass = os.environ["GMAIL_APP_PASSWORD"]

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "LeafSense - Password Reset OTP"
    msg["From"]    = gmail_user
    msg["To"]      = to_email

    html = f"""
    <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:32px;border-radius:12px;background:#f9fafb;border:1px solid #e5e7eb;">
      <h2 style="color:#166534;">LeafSense</h2>
      <p>Your OTP for password reset is:</p>
      <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#166534;margin:24px 0;">{otp}</div>
      <p style="color:#6b7280;font-size:13px;">This OTP expires in <b>10 minutes</b>. Do not share it with anyone.</p>
    </div>
    """
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(gmail_user, gmail_pass)
        smtp.sendmail(gmail_user, to_email, msg.as_string())


#  DB HELPERS 

def get_db() -> psycopg2.extensions.connection:
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)


def init_db() -> None:
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         SERIAL PRIMARY KEY,
                username   VARCHAR(50)  UNIQUE NOT NULL,
                email      VARCHAR(255) UNIQUE NOT NULL,
                password   VARCHAR(255) NOT NULL,
                is_admin   BOOLEAN      DEFAULT FALSE,
                created_at TIMESTAMPTZ  DEFAULT NOW()
            );
        """)
        cur.execute("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS predictions (
                id              SERIAL PRIMARY KEY,
                user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
                predicted_class VARCHAR(255) NOT NULL,
                confidence      FLOAT        NOT NULL,
                severity_pct    FLOAT        NOT NULL,
                stage           VARCHAR(50)  NOT NULL,
                urgency         TEXT         NOT NULL,
                created_at      TIMESTAMPTZ  DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id         SERIAL PRIMARY KEY,
                user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                rating     SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
                category   VARCHAR(50)  NOT NULL,
                message    TEXT,
                is_farmer  BOOLEAN      DEFAULT FALSE,
                created_at TIMESTAMPTZ  DEFAULT NOW()
            );
        """)
        conn.commit()
        print("  DB tables ready")
    finally:
        cur.close()
        conn.close()


#  AUTH HELPERS 

def serialize_user(user: dict) -> dict:
    created = user.get("created_at")
    return {
        "id":         user["id"],
        "username":   user["username"],
        "email":      user["email"],
        "is_admin":   user.get("is_admin", False),
        "created_at": created.isoformat() if created is not None else "",
    }


def create_access_token(user: dict) -> str:
    expire = datetime.now(timezone.utc) + ACCESS_TOKEN_EXPIRE
    payload = {
        "user_id":  user["id"],
        "username": user["username"],
        "email":    user["email"],
        "is_admin": user.get("is_admin", False),
        "exp":      expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            "SELECT id, username, email, is_admin, created_at FROM users WHERE id = %s",
            (user_id,),
        )
        user = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return dict(user)


def verify_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


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
        aug_pred: np.ndarray = model.predict(augment_and_preprocess(raw_arr), verbose=0)[0]
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
    severity_pct    = 0.0 if total_pixels == 0 else round((diseased_pixels / total_pixels) * 100, 2)
    severity_pct    = min(severity_pct, 95.0)

    if severity_pct < 25:
        stage, urgency = "Early",    "Low — monitor daily and apply preventive spray"
    elif severity_pct < 50:
        stage, urgency = "Moderate", "Medium — apply fungicide within 2-3 days"
    elif severity_pct < 75:
        stage, urgency = "Severe",   "High — apply treatment immediately today"
    else:
        stage, urgency = "Critical", "Immediate — treat now and consider isolating the plant"

    return {"severity_pct": severity_pct, "stage": stage, "urgency": urgency}


#  LOAD MODEL & CLASS LABELS 
print("\n  Loading model...")
model = load_model(MODEL_PATH)
print("  Model loaded")

with open(JSON_PATH, "r") as f:
    class_indices: dict = json.load(f)

print(f"  {len(class_indices)} classes loaded\n")


#  PYDANTIC MODELS 
class SignupRequest(BaseModel):
    username: str
    email:    str
    password: str


class LoginRequest(BaseModel):
    email:         str | None = None
    username:      str | None = None
    password:      str
    captcha_token: str = ""


class FeedbackRequest(BaseModel):
    rating:    int
    category:  str
    message:   str  = ""
    is_farmer: bool = False


class AIAdviceRequest(BaseModel):
    predicted_class: str
    confidence:      float
    severity_pct:    float
    stage:           str
    urgency:         str

class ForgotPasswordRequest(BaseModel):
    email: str

class VerifyOTPRequest(BaseModel):
    email: str
    otp:   str

class ResetPasswordRequest(BaseModel):
    email:    str
    otp:      str
    password: str

class TranslateRequest(BaseModel):
    predicted_class: str
    severity_pct:    float
    stage:           str
    lang:            str   


#  FASTAPI APP 
app = FastAPI(title="Plant Disease Detection")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.on_event("startup")
def startup() -> None:
    init_db()


#  FRONTEND ROUTES 

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
def serve_history():
    return FileResponse(f"{FRONTEND_DIR}/history.html")

@app.get("/admin")
def serve_admin():
    return FileResponse(f"{FRONTEND_DIR}/admin.html")


#  AUTH ROUTES 

@app.post("/auth/signup", status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest):
    username = body.username.strip()
    email    = body.email.strip().lower()

    if len(username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE username = %s", (username,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Username already taken")

        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Email already registered")

        hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
        cur.execute(
            "INSERT INTO users (username, email, password) VALUES (%s, %s, %s)",
            (username, email, hashed),
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

    return {"message": "Account created successfully"}


@app.post("/auth/login")
async def login(body: LoginRequest):
    identifier = (body.email or body.username or "").strip().lower()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username is required")

    #  verify reCAPTCHA 
    captcha_ok = await verify_recaptcha(body.captcha_token)
    if not captcha_ok:
        raise HTTPException(status_code=400, detail="CAPTCHA verification failed. Please try again.")

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, username, email, password, is_admin, created_at
            FROM users
            WHERE lower(email) = %s OR lower(username) = %s
            """,
            (identifier, identifier),
        )
        user = cur.fetchone()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_dict = dict(user)
    if not bcrypt.checkpw(body.password.encode(), user_dict["password"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token(user_dict)
    return {
        "message":      "Login successful",
        "access_token": access_token,
        "token_type":   "bearer",
        "role":         "admin" if user_dict.get("is_admin") else "user",
        "expires_in":   int(ACCESS_TOKEN_EXPIRE.total_seconds()),
        "user":         serialize_user(user_dict),
    }


@app.get("/auth/me")
def read_current_user(current_user: dict = Depends(get_current_user)):
    return {"user": serialize_user(current_user)}

@app.post("/auth/forgot-password")
def forgot_password(body: ForgotPasswordRequest):
    email = body.email.strip().lower()

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE lower(email) = %s", (email,))
        if not cur.fetchone():
            # Don't reveal if email exists
            return {"message": "If this email exists, an OTP has been sent."}
    finally:
        cur.close()
        conn.close()

    otp     = str(random.randint(100000, 999999))
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    otp_store[email] = {"otp": otp, "expires": expires}

    try:
        send_otp_email(email, otp)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")

    return {"message": "If this email exists, an OTP has been sent."}


@app.post("/auth/verify-otp")
def verify_otp(body: VerifyOTPRequest):
    email = body.email.strip().lower()
    entry = otp_store.get(email)

    if not entry:
        raise HTTPException(status_code=400, detail="No OTP requested for this email")
    if datetime.now(timezone.utc) > entry["expires"]:
        otp_store.pop(email, None)
        raise HTTPException(status_code=400, detail="OTP has expired")
    if entry["otp"] != body.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    return {"message": "OTP verified"}


@app.post("/auth/reset-password")
def reset_password(body: ResetPasswordRequest):
    email = body.email.strip().lower()
    entry = otp_store.get(email)

    if not entry:
        raise HTTPException(status_code=400, detail="No OTP verified for this email")
    if datetime.now(timezone.utc) > entry["expires"]:
        otp_store.pop(email, None)
        raise HTTPException(status_code=400, detail="OTP has expired")
    if entry["otp"] != body.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            "UPDATE users SET password = %s WHERE lower(email) = %s",
            (hashed, email)
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    otp_store.pop(email, None)
    return {"message": "Password reset successfully"}

async def verify_recaptcha(token: str) -> bool:
    if not RECAPTCHA_SECRET:
        return True  # skip if not configured
    if not token:
        return False
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={
                "secret":   RECAPTCHA_SECRET,
                "response": token,
            }
        )
        result = res.json()
        return result.get("success", False)


#  PREDICT ROUTE

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

@app.post("/gemini-advice")
async def gemini_advice(
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

    try:
        print(f"[Groq] Calling API for: {body.predicted_class}")

        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert agronomist. Always respond with valid JSON only. No markdown, no explanation, just the JSON object."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_tokens=1000,
            temperature=0.3,
        )

        raw_text = (response.choices[0].message.content or "").strip()
        print(f"[Groq] Raw response: {raw_text[:200]}")

        # Strip markdown fences if present
        raw_text = re.sub(r"^```(?:json)?\s*\n?", "", raw_text)
        raw_text = re.sub(r"\n?```\s*$", "", raw_text)
        raw_text = raw_text.strip()

        advice = json.loads(raw_text)

        return {
            "success": True,
            "advice":  advice,
            "model":   "llama-3.1-8b-instant",
        }

    except json.JSONDecodeError as e:
        print(f"[Groq] JSON parse error: {e}")
        print(f"[Groq] Raw text was: {raw_text}")
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
                detail="AI quota exceeded. Please try again in a minute."
            )

        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")
    
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
                {"role": "system", "content": f"You are a translator. Translate to {lang_name} only. Return only the translated text with no explanation."},
                {"role": "user",   "content": prompt}
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


#  FEEDBACK ROUTE 

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
            INSERT INTO feedback (user_id, rating, category, message, is_farmer)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                current_user["id"],
                body.rating,
                body.category.strip(),
                body.message.strip()[:500],
                body.is_farmer,
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


#  ADMIN ROUTES 

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
            SELECT
                f.id, f.rating, f.category, f.message,
                f.is_farmer, f.created_at, u.username
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
            SELECT
                p.id, p.user_id, p.predicted_class, p.confidence,
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
        user = dict(user)
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


# STATIC FILE FALLBACK 

@app.get("/{filename:path}")
def serve_file(filename: str):
    filepath = os.path.join(FRONTEND_DIR, filename)
    if os.path.exists(filepath) and os.path.isfile(filepath):
        return FileResponse(filepath)
    return FileResponse(f"{FRONTEND_DIR}/login.html")


#  RUN APP 
if __name__ == "__main__":
    def open_browser():
        time.sleep(2)
        webbrowser.open("http://localhost:8000/login.html")
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)