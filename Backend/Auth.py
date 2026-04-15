import random
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import bcrypt
import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import (
    ACCESS_TOKEN_EXPIRE,
    ALGORITHM,
    GMAIL_PASS,
    GMAIL_USER,
    RECAPTCHA_SECRET,
    SECRET_KEY,
)
from database import get_db
from schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    ChangePasswordRequest,
    VerifyOTPRequest,
)

#  BEARER SCHEME 
bearer_scheme = HTTPBearer(auto_error=False)

#  IN-MEMORY OTP STORE  {email: {otp, expires}} 
otp_store: dict = {}

#  ROUTER 
router = APIRouter(prefix="/auth", tags=["auth"])


# EMAIL HELPER
def send_otp_email(to_email: str, otp: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "LeafSense - Password Reset OTP"
    msg["From"]    = GMAIL_USER
    msg["To"]      = to_email

    html = f"""
    <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:32px;
                border-radius:12px;background:#f9fafb;border:1px solid #e5e7eb;">
      <h2 style="color:#166534;">LeafSense</h2>
      <p>Your OTP for password reset is:</p>
      <div style="font-size:36px;font-weight:800;letter-spacing:8px;
                  color:#166534;margin:24px 0;">{otp}</div>
      <p style="color:#6b7280;font-size:13px;">
        This OTP expires in <b>10 minutes</b>. Do not share it with anyone.
      </p>
    </div>
    """
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL_USER, GMAIL_PASS)
        smtp.sendmail(GMAIL_USER, to_email, msg.as_string())


# JWT HELPERS 
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


#  DEPENDENCIES 
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


# RECAPTCHA
async def verify_recaptcha(token: str) -> bool:
    if not RECAPTCHA_SECRET:
        return True
    if not token:
        return False
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={"secret": RECAPTCHA_SECRET, "response": token},
        )
        return res.json().get("success", False)


#  AUTH ROUTES 
@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest):
    username = body.username.strip()
    email    = body.email.strip().lower()

    if len(username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
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


@router.post("/login")
async def login(body: LoginRequest):
    identifier = (body.email or body.username or "").strip().lower()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username is required")

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


@router.get("/me")
def read_current_user(current_user: dict = Depends(get_current_user)):
    return {"user": serialize_user(current_user)}


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest):
    email = body.email.strip().lower()

    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE lower(email) = %s", (email,))
        if not cur.fetchone():
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


@router.post("/verify-otp")
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


@router.post("/reset-password")
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
            (hashed, email),
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

# DELETE ACCOUNT
@router.delete("/delete-account")
def delete_account(current_user: dict = Depends(get_current_user)):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("DELETE FROM users WHERE id = %s", (current_user["id"],))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    return {"message": "Account deleted successfully"}

# CHANGE PASSWORD
@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute("SELECT password FROM users WHERE id = %s", (current_user["id"],))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        if not bcrypt.checkpw(body.current_password.encode(), dict(row)["password"].encode()):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        if len(body.new_password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

        hashed = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
        cur.execute("UPDATE users SET password = %s WHERE id = %s", (hashed, current_user["id"]))
        conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

    return {"message": "Password updated successfully"}