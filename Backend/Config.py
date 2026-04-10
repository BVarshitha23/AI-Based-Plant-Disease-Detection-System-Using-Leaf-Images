import os
from datetime import timedelta
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

# ML CONFIG 
MODEL_PATH = r"D:\Custom_dataset\Output\mobilenetv2_unfreeze50_best.keras"
JSON_PATH  = r"D:\Custom_dataset\Output\class_labels.json"
IMG_SIZE   = (224, 224)
TTA_STEPS  = 5

# FRONTEND
FRONTEND_DIR = r"D:\AI-Based-Plant-Disease-Detection-System-Using-Leaf-Images\Frontend"

#  JWT
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set in .env — server cannot start")

ALGORITHM           = "HS256"
ACCESS_TOKEN_EXPIRE = timedelta(days=1)

# DATABASE
DB_CONFIG = {
    "host":     os.environ.get("DB_HOST"),
    "port":     int(os.environ.get("DB_PORT", "5432")),
    "dbname":   os.environ.get("DB_NAME"),
    "user":     os.environ.get("DB_USER"),
    "password": os.environ.get("DB_PASSWORD"),
}

# GROQ 
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

if GROQ_API_KEY:
    groq_client = Groq(api_key=GROQ_API_KEY)
    print("  Groq AI ready")
else:
    groq_client = None
    print("  GROQ_API_KEY not set — /groq-advice will return 503")

# RECAPTCHA 
RECAPTCHA_SECRET = os.environ.get("RECAPTCHA_SECRET_KEY")

#  EMAIL 
GMAIL_USER = os.environ.get("GMAIL_USER", "")
GMAIL_PASS = os.environ.get("GMAIL_APP_PASSWORD", "")