# LeafSense — AI-Based-Plant-Disease-Detection-System-Using-Leaf-Images

> Deep learning-powered plant disease detection with severity analysis, AI agronomist advice, and multilingual voice output.

![Python](https://img.shields.io/badge/Python-3.10+-blue) ![TensorFlow](https://img.shields.io/badge/TensorFlow-2.x-orange) ![FastAPI](https://img.shields.io/badge/FastAPI-0.11x-teal) ![License](https://img.shields.io/badge/License-MIT-green)

---

## Overview

LeafSense is a full-stack web application that lets farmers and agricultural professionals upload a leaf image and instantly receive a disease diagnosis, severity estimate, AI-generated treatment advice, and results in their regional language — all in under 3 seconds.

The system is built on a two-phase MobileNetV2 training pipeline (transfer learning + fine-tuning), served via FastAPI, and augmented with Groq's Llama 3.1-8b for structured agronomist recommendations.

---

## Features

| Feature | Description |
|---|---|
| Disease Classification | 23 classes across multiple crops via MobileNetV2 + Test-Time Augmentation |
| Severity Analysis | OpenCV HSV pipeline — Early / Moderate / Severe / Critical staging |
| AI Agronomist Advice | Groq Llama 3.1 — structured JSON with immediate actions & prevention tips |
| Multilingual Output | Hindi, Telugu, Tamil, Kannada + Web Speech API voice readout |
| Prediction History | Search, filter, sort, paginate, and export CSV |
| Secure Authentication | JWT, bcrypt, Google reCAPTCHA v2, OTP-based email password reset |
| Admin Dashboard | Manage users, detections, feedback & admin roles |
| Drag & Drop UI | Real-time progress animation, severity gauge, confidence indicator |

---

## Tech Stack

| Layer | Technology |
|---|---|
| ML Model | MobileNetV2 (TensorFlow/Keras) — ImageNet pretrained + fine-tuned |
| Image Processing | OpenCV 4.x — preprocessing & HSV severity analysis |
| Backend | FastAPI + Uvicorn — async REST API |
| LLM Integration | Groq SDK — Llama 3.1-8b-instant (advice + translation) |
| Database | PostgreSQL 14+ with psycopg2 |
| Authentication | python-jose (JWT), bcrypt, httpx (reCAPTCHA), smtplib (OTP) |
| Frontend | HTML5, CSS3, JavaScript, Lucide Icons |
| Dataset | Plant Disease Detection — Kaggle (23 disease classes) |

---

## Project Structure

```
LeafSense/
├── Backend/
│   ├── Main.py           # FastAPI app — all routes & ML helpers
│   ├── Auth.py           # JWT auth, signup, login, OTP reset
│   ├── Model.py          # Phase 1 training — MobileNetV2 + custom head
│   ├── Finetuning.py     # Phase 2 — unfreeze top 50 layers + AdamW
│   ├── Preprocessing.py  # ImageDataGenerator pipelines
│   ├── Predicting.py     # TTA inference (standalone)
│   ├── Testing.py        # Model evaluation + classification report
│   ├── Database.py       # PostgreSQL connection & schema init
│   ├── Schemas.py        # Pydantic request/response models
│   └── Config.py         # Env vars, paths, Groq client
└── Frontend/
    ├── index.html / detect.html / history.html
    ├── login.html / register.html / profile.html
    ├── admin.html / feedback.html / about.html
    ├── CSS/              # Per-page stylesheets
    └── Scripts/          # auth.js, detect.js, history.js ...
```

---

## Model Training Pipeline

### Phase 1 — Transfer Learning (`Model.py`)
- MobileNetV2 base frozen with ImageNet weights
- Custom head: `GlobalAveragePooling2D → BatchNorm → Dense(512) → Dropout(0.2) → Dense(256) → Dropout(0.1) → Softmax(23)`
- Optimizer: Adam lr=1e-3 | Epochs: 15 | Batch size: 32
- Callbacks: EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
- Class imbalance handled via `compute_class_weight('balanced')`

### Phase 2 — Fine-Tuning (`Finetuning.py`)
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

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/predict` | Upload leaf image → disease + severity JSON |
| `POST` | `/gemini-advice` | Groq LLM structured agronomist advice |
| `POST` | `/api/translate` | Translate result to regional Indian language |
| `GET` | `/api/history` | Authenticated user's prediction history |
| `POST` | `/feedback` | Submit user feedback (rating + message) |
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

---

## Environment Variables

Create a `.env` file in the `Backend/` directory:

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
python Backend/Model.py          # Phase 1 — transfer learning
python Backend/Finetuning.py     # Phase 2 — fine-tuning

# 5. Update model paths in Config.py
#    MODEL_PATH → path to mobilenetv2_unfreeze50_best.keras
#    JSON_PATH  → path to class_labels.json

# 6. Run the server
cd Backend
uvicorn Main:app --host 0.0.0.0 --port 8000 --reload

# 7. Open in browser
# http://localhost:8000
```

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

> Tables are auto-created on server startup via `init_db()` — no manual migration needed.

---

## How It Works

1. User uploads a leaf image through the web interface
2. FastAPI decodes the image and runs **5 TTA forward passes** through MobileNetV2
3. Predictions are averaged → highest probability class selected
4. **OpenCV HSV analysis** estimates disease severity (0–95%) and assigns a stage
5. Result is saved to PostgreSQL and returned as JSON
6. Frontend renders the disease name, confidence bar, severity gauge, and stage badges
7. **Groq Llama 3.1** generates structured agronomist advice asynchronously
8. User can switch language → result translated via Groq → spoken via Web Speech API

---

## Dataset

- **Source:** [Plant Disease Detection — Kaggle](https://www.kaggle.com/datasets)
- **Classes:** 23 disease categories across multiple crop species (tomato, potato, apple, corn, pepper, and more)
- **Split:** Train / Validation / Test
- **Preprocessing:** MobileNetV2 `preprocess_input` normalisation (scales to [-1, 1])
- **Augmentation:** Rotation, flips, brightness, zoom, shear, random crop

---

## License

This project is licensed under the MIT License.

---

*Built with TensorFlow · FastAPI · Groq · PostgreSQL · OpenCV*