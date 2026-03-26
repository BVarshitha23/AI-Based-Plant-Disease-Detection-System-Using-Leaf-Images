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

load_dotenv()

# CONFIG
MODEL_PATH   = r"D:\Custom_dataset\Output\mobilenetv2_unfreeze50_best.keras"
JSON_PATH    = r"D:\Custom_dataset\Output\class_labels.json"
IMG_SIZE     = (224, 224)
TTA_STEPS    = 5
FRONTEND_DIR = r"D:\fastapi practice\Frontend"

# JWT CONFIG
SECRET_KEY          = os.getenv("SECRET_KEY")
ALGORITHM           = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(days=1)
bearer_scheme       = HTTPBearer(auto_error=False)

# DB CONFIG 
DB_CONFIG = {
    "host":     os.getenv("DB_HOST"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME"),
    "user":     os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}


def get_db() -> psycopg2.extensions.connection:
    """Returns a new PostgreSQL connection with dict-style rows."""
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)


def init_db() -> None:
    """Creates tables if they don't exist."""
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         SERIAL PRIMARY KEY,
                username   VARCHAR(50)  UNIQUE NOT NULL,
                email      VARCHAR(255) UNIQUE NOT NULL,
                password   VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ  DEFAULT NOW()
            );
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
        conn.commit()
        print("  DB tables ready")
    finally:
        cur.close()
        conn.close()


# AUTH HELPERS 

def serialize_user(user: dict) -> dict:
    created = user.get("created_at")
    return {
        "id":         user["id"],
        "username":   user["username"],
        "email":      user["email"],
        "created_at": created.isoformat() if created is not None else "",
    }


def create_access_token(user: dict) -> str:
    expire = datetime.now(timezone.utc) + ACCESS_TOKEN_EXPIRE
    payload = {
        "user_id":  user["id"],
        "username": user["username"],
        "email":    user["email"],
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
            "SELECT id, username, email, created_at FROM users WHERE id = %s",
            (user_id,),
        )
        user = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return dict(user)


# ML HELPERS 

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
    base_pred: np.ndarray  = model.predict(base_input, verbose=0)[0]
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

    img  = cv2.resize(img, (224, 224))
    hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask_brown1  = cv2.inRange(hsv, np.array([10, 40, 40]),  np.array([20, 255, 255]))
    mask_brown2  = cv2.inRange(hsv, np.array([20, 30, 30]),  np.array([35, 255, 200]))
    mask_dark    = cv2.inRange(hsv, np.array([0,  0,  0]),   np.array([180, 255, 60]))
    disease_mask = cv2.bitwise_or(cv2.bitwise_or(mask_brown1, mask_brown2), mask_dark)
    leaf_mask    = cv2.inRange(hsv, np.array([35, 40, 40]),  np.array([90, 255, 255]))

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


# LOAD MODEL & CLASS LABELS 
print("\n  Loading model...")
model = load_model(MODEL_PATH)
print("  Model loaded")

with open(JSON_PATH, "r") as f:
    class_indices: dict = json.load(f)

print(f"  {len(class_indices)} classes loaded\n")


# PYDANTIC MODELS 

class SignupRequest(BaseModel):
    username: str
    email:    str
    password: str


class LoginRequest(BaseModel):
    email:    str | None = None   
    username: str | None = None
    password: str


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


# FRONTEND ROUTES 

@app.get("/")
def serve_home():
    return FileResponse(f"{FRONTEND_DIR}/index.html")

@app.get("/detect")
def serve_detect():
    return FileResponse(f"{FRONTEND_DIR}/detect.html")

@app.get("/login")
def serve_login():
    return FileResponse(f"{FRONTEND_DIR}/login.html")

@app.get("/register")
def serve_register():
    return FileResponse(f"{FRONTEND_DIR}/register.html")

@app.get("/history")
def serve_history():
    return FileResponse(f"{FRONTEND_DIR}/history.html")


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
def login(body: LoginRequest):
    # Accept either email or username field
    identifier = (body.email or body.username or "").strip().lower()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email is required")

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, username, email, password, created_at
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
        "expires_in":   int(ACCESS_TOKEN_EXPIRE.total_seconds()),
        "user":         serialize_user(user_dict),
    }


@app.get("/auth/me")
def read_current_user(current_user: dict = Depends(get_current_user)):
    return {"user": serialize_user(current_user)}


# PREDICT ROUTE 
@app.post("/predict")
async def predict(
    file:         UploadFile = File(...),
    current_user: dict       = Depends(get_current_user),   # JWT required
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


#  HISTORY API ROUTE 

@app.get("/api/history")
def get_history(current_user: dict = Depends(get_current_user)):
    """Returns predictions for the logged-in user only, newest first."""
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


#  STATIC FILE FALLBACK 

@app.get("/{filename:path}")
def serve_file(filename: str):
    filepath = os.path.join(FRONTEND_DIR, filename)
    if os.path.exists(filepath) and os.path.isfile(filepath):
        return FileResponse(filepath)
    return FileResponse(f"{FRONTEND_DIR}/index.html")


# RUN APP
if __name__ == "__main__":
    def open_browser():
        time.sleep(2)
        webbrowser.open("http://localhost:8000")
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)