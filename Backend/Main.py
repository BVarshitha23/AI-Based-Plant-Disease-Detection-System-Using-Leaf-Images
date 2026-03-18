from fastapi import FastAPI, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import webbrowser
import threading
import time
import uvicorn
import numpy as np
import json
import io
import cv2
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import img_to_array
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from PIL import Image
from fastapi.middleware.cors import CORSMiddleware

#  CONFIG 
MODEL_PATH  = r"D:\Custom_dataset\Output\mobilenetv2_unfreeze50_best.keras"
JSON_PATH   = r"D:\Custom_dataset\Output\class_labels.json"
IMG_SIZE    = (224, 224)
TTA_STEPS   = 5
FRONTEND_DIR = r"D:\fastapi practice\Frontend"

#  LOAD MODEL & CLASS LABELS 
print("\n  Loading model...")
model = load_model(MODEL_PATH)
print("  Model loaded ")

with open(JSON_PATH, "r") as f:
    class_indices = json.load(f)

print(f"  {len(class_indices)} classes loaded \n")

# FastAPI app
app = FastAPI(title="Plant Disease Detection")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve Frontend
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
 
@app.get("/")
def serve_home():
    return FileResponse(f"{FRONTEND_DIR}/index.html")
 
@app.get("/detect")
def serve_detect():
    return FileResponse(f"{FRONTEND_DIR}/detect.html")
 
@app.get("/{filename:path}")
def serve_file(filename: str):
    import os
    filepath = os.path.join(FRONTEND_DIR, filename)
    if os.path.exists(filepath) and os.path.isfile(filepath):
        return FileResponse(filepath)
    return FileResponse(f"{FRONTEND_DIR}/index.html")

# HELPER: Format label nicely
def format_label(label: str) -> str:
    return label.replace("___", " - ").replace("_", " ").title()


# HELPER: Load image from bytes 
def load_raw_from_bytes(image_bytes: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image = image.resize(IMG_SIZE)
    return img_to_array(image)


def augment_and_preprocess(raw_arr: np.ndarray) -> np.ndarray:
    img = raw_arr.copy()
    img += np.random.uniform(-10, 10)
    img  = np.clip(img, 0, 255)
    if np.random.rand() > 0.5:
        img = np.fliplr(img)
    img = np.expand_dims(img, axis=0)
    img = preprocess_input(img)
    return img


# PREDICT WITH TTA 
def predict_with_tta(image_bytes: bytes) -> np.ndarray:
    raw_arr   = load_raw_from_bytes(image_bytes)
    base_input = preprocess_input(np.expand_dims(raw_arr.copy(), axis=0))
    base_pred  = model.predict(base_input, verbose=0)[0]
    tta_preds  = [base_pred]
    for _ in range(TTA_STEPS - 1):
        aug_pred = model.predict(augment_and_preprocess(raw_arr), verbose=0)[0]
        tta_preds.append(aug_pred)
    return np.mean(tta_preds, axis=0)


# SEVERITY CALCULATION USING OPENCV 
def calculate_severity(image_bytes: bytes, predicted_label: str) -> dict:
    if "healthy" in predicted_label.lower():
        return {
            "severity_pct": 0.0,
            "stage":        "Healthy",
            "urgency":      "None"
        }

    # Decode image bytes → OpenCV BGR image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return {
            "severity_pct": 0.0,
            "stage":        "Unknown",
            "urgency":      "Unknown"
        }

    # Resize for consistent analysis
    img = cv2.resize(img, (224, 224))

    # Convert to HSV color space
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # Detect DISEASED pixels (brown / yellow / dark spots)
    # Brown range
    lower_brown1 = np.array([10,  40,  40])
    upper_brown1 = np.array([20, 255, 255])
    mask_brown1  = cv2.inRange(hsv, lower_brown1, upper_brown1)

    # Dark yellow / tan range
    lower_brown2 = np.array([20,  30,  30])
    upper_brown2 = np.array([35, 255, 200])
    mask_brown2  = cv2.inRange(hsv, lower_brown2, upper_brown2)

    # Dark / necrotic spots (very dark pixels)
    lower_dark = np.array([0,   0,   0])
    upper_dark = np.array([180, 255, 60])
    mask_dark  = cv2.inRange(hsv, lower_dark, upper_dark)

    # Combine all diseased masks
    disease_mask = cv2.bitwise_or(mask_brown1, mask_brown2)
    disease_mask = cv2.bitwise_or(disease_mask, mask_dark)

    # Detect HEALTHY green leaf pixels
    lower_green = np.array([35,  40,  40])
    upper_green = np.array([90, 255, 255])
    leaf_mask   = cv2.inRange(hsv, lower_green, upper_green)

    #  Count pixels 
    diseased_pixels = cv2.countNonZero(disease_mask)
    healthy_pixels  = cv2.countNonZero(leaf_mask)
    total_pixels    = diseased_pixels + healthy_pixels

    if total_pixels == 0:
        severity_pct = 0.0
    else:
        severity_pct = round((diseased_pixels / total_pixels) * 100, 2)

    # Cap at 95% — model may misread very dry/dark images
    severity_pct = min(severity_pct, 95.0)

    #  Stage classification 
    if severity_pct < 25:
        stage   = "Early"
        urgency = "Low — monitor daily and apply preventive spray"
    elif severity_pct < 50:
        stage   = "Moderate"
        urgency = "Medium — apply fungicide within 2-3 days"
    elif severity_pct < 75:
        stage   = "Severe"
        urgency = "High — apply treatment immediately today"
    else:
        stage   = "Critical"
        urgency = "Immediate — treat now and consider isolating the plant"

    return {
        "severity_pct": severity_pct,
        "stage":        stage,
        "urgency":      urgency
    }


# MAIN ENDPOINT 
@app.post("/predict")
async def predict(file: UploadFile = File(...)):

    # Step 1: Read uploaded image
    image_bytes = await file.read()

    # Step 2: Predict disease with TTA
    predictions = predict_with_tta(image_bytes)

    # Step 3: Get best class
    best_idx   = str(np.argmax(predictions))
    best_label = class_indices.get(best_idx, "Unknown")
    confidence = float(np.max(predictions))

    # Step 4: Format label
    formatted_label = format_label(best_label)

    # Step 5: Calculate severity using OpenCV
    severity = calculate_severity(image_bytes, best_label)

    # Step 6: Return full response
    return {
        "predicted_class" : formatted_label,
        "confidence"      : round(confidence * 100, 2),
        "severity_pct"    : severity["severity_pct"],
        "stage"           : severity["stage"],
        "urgency"         : severity["urgency"]
    }


# Run 
if __name__ == "__main__":
     def open_browser():
        time.sleep(2)
        webbrowser.open("http://localhost:8000")
 
threading.Thread(target=open_browser, daemon=True).start()
uvicorn.run(app, host="0.0.0.0", port=8000)