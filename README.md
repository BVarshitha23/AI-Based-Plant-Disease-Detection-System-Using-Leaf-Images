# LeafSense — AI-Based Plant Disease Detection System Using Leaf Images

> Deep learning-powered plant disease detection with severity analysis, weather-aware AI agronomist advice, spray scheduling, and multilingual voice output.

![Python](https://img.shields.io/badge/Python-3.10+-blue) ![TensorFlow](https://img.shields.io/badge/TensorFlow-2.x-orange) ![FastAPI](https://img.shields.io/badge/FastAPI-0.11x-teal) ![License](https://img.shields.io/badge/License-MIT-green)

---

## Overview

LeafSense is a full-stack web application that lets farmers and agricultural professionals upload a leaf image and instantly receive a disease diagnosis, severity estimate, AI-generated treatment advice, a real-time weather-aware spray schedule, and results in their regional language — all in under 3 seconds.

The system is built on a two-phase MobileNetV2 training pipeline (transfer learning + fine-tuning), served via FastAPI, and augmented with Groq's Llama 3.1-8b for structured agronomist recommendations. Live weather and soil data are fetched via the user's GPS location to deliver context-aware, field-ready advice.

---

## Features

| Feature | Description |
|---|---|
| Disease Classification | 23 classes across multiple crops via MobileNetV2 + Test-Time Augmentation |
| Severity Analysis | OpenCV HSV pipeline — Early / Moderate / Severe / Critical staging |
| AI Agronomist Advice | Groq Llama 3.1 — structured JSON with immediate actions & prevention tips |
| Weather-Aware Analysis | Live weather + soil data fetched via GPS — disease advice adapts to current field conditions |
| Spray Scheduler | AI-generated spray schedule with cost estimates (INR), interval days, and weather safety check |
| Downloadable Scan Report | Export full diagnosis report as PDF or PNG image |
| Live Camera Capture | Capture leaf photos directly via device camera (supports front/rear camera switching) |
| Multilingual Output | Hindi, Telugu, Tamil, Kannada + Web Speech API voice readout |
| Prediction History | Search, filter, sort, paginate, and export CSV |
| Secure Authentication | JWT, bcrypt, Google reCAPTCHA v2, OTP-based email password reset |
| Admin Dashboard | Manage users, detections, and feedback — with individual record deletion |
| Offline Guard | Network detection page with auto-retry every 8 seconds |
| Drag & Drop UI | Real-time progress animation, severity gauge, confidence indicator |

---

## Tech Stack

| Layer | Technology |
|---|---|
| ML Model | MobileNetV2 (TensorFlow/Keras) — ImageNet pretrained + fine-tuned |
| Image Processing | OpenCV 4.x — preprocessing & HSV severity analysis |
| Backend | FastAPI + Uvicorn — async REST API |
| LLM Integration | Groq SDK — Llama 3.1-8b-instant (advice, spray scheduling & translation) |
| Weather & Soil | Open-Meteo / Nominatim — real-time GPS-based weather + soil type |
| Database | PostgreSQL 14+ with psycopg2 |
| Authentication | python-jose (JWT), bcrypt, httpx (reCAPTCHA), smtplib (OTP) |
| Frontend | HTML5, CSS3, JavaScript, Lucide Icons, jsPDF, html2canvas |
| Dataset | Plant Disease Detection — Kaggle (23 disease classes) |

---

## Project Structure

```
LeafSense/
├── backend/
│   ├── main.py             # FastAPI app — all routes & ML helpers
│   ├── auth.py             # JWT auth, signup, login, OTP reset
│   ├── trained_model.py    # Phase 1 training — MobileNetV2 + custom head
│   ├── finetuning.py       # Phase 2 — unfreeze top 50 layers + AdamW
│   ├── preprocessing.py    # ImageDataGenerator pipelines
│   ├── predicting.py       # TTA inference (standalone)
│   ├── testing.py          # Model evaluation + classification report
│   ├── database.py         # PostgreSQL connection & schema init
│   ├── schemas.py          # Pydantic request/response models
│   ├── config.py           # Env vars, paths, Groq client
│   ├── weather.py          # Live weather, soil & location helpers
│   ├── class_labels.json   # 23-class index → label mapping
│   └── datasets/           # Training CSVs and class name arrays
└── Frontend/
    ├── index.html          # Home / landing page
    ├── detect.html         # Main detection interface
    ├── history.html        # Prediction history with CSV export
    ├── login.html / register.html / profile.html
    ├── admin.html          # Admin dashboard
    ├── feedback.html       # User feedback form
    ├── about.html          # Project information
    ├── network.html        # Offline guard page
    ├── css/                # Per-page stylesheets
    └── scripts/            # auth.js, detect.js, history.js, cam.js, network.js ...
```

---

## Model Training Pipeline

### Phase 1 — Transfer Learning (`trained_model.py`)
- MobileNetV2 base frozen with ImageNet weights
- Custom head: `GlobalAveragePooling2D → BatchNorm → Dense(512) → Dropout(0.2) → Dense(256) → Dropout(0.1) → Softmax(23)`
- Optimizer: Adam lr=1e-3 | Epochs: 15 | Batch size: 32
- Callbacks: EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
- Class imbalance handled via `compute_class_weight('balanced')`

### Phase 2 — Fine-Tuning (`finetuning.py`)
- Top 50 MobileNetV2 backbone layers unfrozen
- New classification head attached to `out_relu` layer
- tf.data pipeline with advanced augmentation (random crop, flips, contrast)
- Optimizer: AdamW lr=5e-5, weight_decay=1e-4
- Metrics: Accuracy + Top-3 Accuracy | CSVLogger for run tracking
- Epochs: up to 30 with EarlyStopping patience=8

### Inference — Test-Time Augmentation (TTA)
- 5 forward passes per image (1 base + 4 augmented with brightness jitter & flips)
- Predictions averaged for robust, reliable results

---

## Supported Crops & Diseases (23 Classes)

| Crop | Diseases Detected |
|---|---|
| Apple | Apple Scab, Black Rot, Cedar Apple Rust, Healthy |
| Corn (Maize) | Cercospora Leaf Spot / Gray Leaf Spot, Common Rust, Northern Leaf Blight, Healthy |
| Pepper (Bell) | Bacterial Spot, Healthy |
| Potato | Early Blight, Late Blight, Healthy |
| Tomato | Bacterial Spot, Early Blight, Late Blight, Leaf Mold, Septoria Leaf Spot, Spider Mites, Target Spot, Yellow Leaf Curl Virus, Mosaic Virus, Healthy |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/predict` | Upload leaf image → disease + severity JSON |
| `POST` | `/groq-advice` | Groq LLM structured agronomist advice |
| `POST` | `/weather-advice` | Weather + soil + AI combined field analysis |
| `POST` | `/groq-cost-spray` | AI spray schedule with cost estimate (INR) |
| `POST` | `/api/translate` | Translate result to regional Indian language |
| `GET` | `/api/history` | Authenticated user's prediction history |
| `POST` | `/feedback` | Submit user feedback (rating + message) |
| `GET` | `/health` | Server health check |
| `POST` | `/auth/signup` | Register new user |
| `POST` | `/auth/login` | Login with reCAPTCHA → JWT token |
| `POST` | `/auth/forgot-password` | Send OTP to registered email |
| `POST` | `/auth/verify-otp` | Verify OTP for password reset |
| `POST` | `/auth/reset-password` | Set new password with valid OTP |
| `POST` | `/auth/change-password` | Change password (authenticated) |
| `DELETE` | `/auth/delete-account` | Delete account and all associated data |
| `GET` | `/admin/users` | Admin — all registered users |
| `GET` | `/admin/detections` | Admin — all prediction records |
| `GET` | `/admin/feedback` | Admin — all submitted feedback |
| `PATCH` | `/admin/users/{id}/toggle-admin` | Promote / demote admin role |
| `DELETE` | `/admin/users/{id}` | Admin — delete a user |
| `DELETE` | `/admin/detections/{id}` | Admin — delete a detection record |
| `DELETE` | `/admin/feedback/{id}` | Admin — delete a feedback entry |

---

## Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Security
SECRET_KEY=your_jwt_secret_key_here

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=plant_disease_db
DB_USER=postgres
DB_PASSWORD=your_db_password

# Groq AI
GROQ_API_KEY=your_groq_api_key

# Google reCAPTCHA
RECAPTCHA_SECRET_KEY=your_recaptcha_secret_key

# Gmail (OTP emails)
GMAIL_USER=your_gmail@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
```

Also update the following paths in `backend/config.py` to match your local environment:

```python
MODEL_PATH   = r"path/to/mobilenetv2_unfreeze50_best.keras"
JSON_PATH    = r"path/to/class_labels.json"
FRONTEND_DIR = r"path/to/Frontend"
```

---

## Installation & Setup

```bash
# 1. Clone the repository
git clone https://github.com/BVarshitha23/AI-Based-Plant-Disease-Detection-System-Using-Leaf-Images
cd AI-Based-Plant-Disease-Detection-System-Using-Leaf-Images

# 2. Install Python dependencies
pip install tensorflow fastapi uvicorn opencv-python psycopg2-binary \
            groq python-jose[cryptography] bcrypt httpx python-dotenv \
            pillow scikit-learn matplotlib

# 3. Configure environment
cp .env.example .env    # fill in your credentials

# 4. Train the model (skip if using pre-trained weights)
python backend/trained_model.py     # Phase 1 — transfer learning
python backend/finetuning.py        # Phase 2 — fine-tuning

# 5. Update paths in config.py
#    MODEL_PATH → path to mobilenetv2_unfreeze50_best.keras
#    JSON_PATH  → path to class_labels.json
#    FRONTEND_DIR → path to Frontend/

# 6. Run the server
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 7. Open in browser
# http://localhost:8000
```

> **Note:** The server auto-opens the browser on startup. Tables are auto-created via `init_db()` — no manual migration needed.

---

## Database Schema

```sql
-- Users
CREATE TABLE users (
    id         SERIAL PRIMARY KEY,
    username   VARCHAR(50)  UNIQUE NOT NULL,
    email      VARCHAR(255) UNIQUE NOT NULL,
    password   VARCHAR(255) NOT NULL,       -- bcrypt hashed
    is_admin   BOOLEAN      DEFAULT FALSE,
    created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Predictions
CREATE TABLE predictions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    predicted_class VARCHAR(255) NOT NULL,
    confidence      FLOAT        NOT NULL,
    severity_pct    FLOAT        NOT NULL,
    stage           VARCHAR(50)  NOT NULL,
    urgency         TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- Feedback
CREATE TABLE feedback (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    category   VARCHAR(50) NOT NULL,
    message    TEXT,
    is_farmer  BOOLEAN     DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## How It Works

1. User uploads or captures a leaf image through the web interface
2. FastAPI decodes the image and runs **5 TTA forward passes** through MobileNetV2
3. Predictions are averaged → highest probability class selected
4. **OpenCV HSV analysis** estimates disease severity (0–95%) and assigns a stage
5. If GPS is granted, live **weather + soil data** is fetched and merged with the diagnosis
6. Result is saved to PostgreSQL and returned as JSON
7. Frontend renders the disease name, confidence bar, severity gauge, and stage badges
8. **Groq Llama 3.1** generates structured agronomist advice along with a **spray schedule** (dates, cost estimate in INR, weather safety status)
9. User can switch language → result translated via Groq → spoken via Web Speech API
10. A full scan **report** can be exported as PDF or PNG

---

## Dataset

- **Source:** [Plant Disease Detection — Kaggle](https://www.kaggle.com/datasets)
- **Classes:** 23 disease categories across multiple crop species (tomato, potato, apple, corn, pepper)
- **Split:** Train / Validation / Test
- **Preprocessing:** MobileNetV2 `preprocess_input` normalisation (scales to [-1, 1])
- **Augmentation:** Rotation, flips, brightness, zoom, shear, random crop

---

## Author

**B. Varshitha**
- GitHub: [@BVarshitha23](https://github.com/BVarshitha23)

---

*Built with TensorFlow · FastAPI · Groq · PostgreSQL · OpenCV*