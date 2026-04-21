import re
from pydantic import BaseModel, field_validator


class SignupRequest(BaseModel):
    username: str
    email:    str
    password: str

    @field_validator("password")
    @classmethod
    def strong_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters.")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number.")
        if not re.search(r"[^a-zA-Z0-9]", v):
            raise ValueError("Password must contain at least one special character.")
        return v
    
    @field_validator("email")
    @classmethod
    def gmail_only(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9._%+-]+@gmail\.com$", v.strip(), re.IGNORECASE):
            raise ValueError("Only Gmail addresses (@gmail.com) are accepted.")
        return v.strip().lower()


class LoginRequest(BaseModel):
    email:         str | None = None
    username:      str | None = None
    password:      str
    captcha_token: str = ""


class FeedbackRequest(BaseModel):
    rating:    int
    category:  str
    message:   str  = ""


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

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str

class WeatherAdviceRequest(BaseModel):
    predicted_class:   str
    confidence:        float
    severity_pct:      float
    stage:             str
    urgency:           str
    latitude:          float
    longitude:         float
    soil_type:         str = "Unknown"
    sowing_date:       str = ""         
    irrigation_method: str = "Unknown"   