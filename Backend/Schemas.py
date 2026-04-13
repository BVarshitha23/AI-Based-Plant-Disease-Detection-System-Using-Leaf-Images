from pydantic import BaseModel


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

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str