from fastapi import FastAPI, File, UploadFile
import uvicorn
import numpy as np
import json
import io
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import load_img, img_to_array
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from PIL import Image
from fastapi.middleware.cors import CORSMiddleware

# CONFIG 
MODEL_PATH  = r"D:\Custom_dataset\Output\mobilenetv2_unfreeze50_best.keras"
JSON_PATH   = r"D:\Custom_dataset\Output\class_labels.json"
IMG_SIZE    = (224, 224)
TTA_STEPS   = 5                     

# LOAD MODEL & CLASS LABELS 
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


#  Format label nicely
def format_label(label: str) -> str:
    return label.replace("___", " - ").replace("_", " ").title()


#  Load image from bytes (replaces load_img from file) 
def load_raw_from_bytes(image_bytes: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image = image.resize(IMG_SIZE)          
    return img_to_array(image)              

def augment_and_preprocess(raw_arr: np.ndarray) -> np.ndarray:
    img = raw_arr.copy()

    # Soft brightness jitter
    img += np.random.uniform(-10, 10)
    img  = np.clip(img, 0, 255)

    # Horizontal flip only
    if np.random.rand() > 0.5:
        img = np.fliplr(img)

    img = np.expand_dims(img, axis=0)
    img = preprocess_input(img)             
    return img


#  Predict with TTA 
def predict_with_tta(image_bytes: bytes) -> np.ndarray:
    raw_arr = load_raw_from_bytes(image_bytes)

    # Base prediction (no augmentation)
    base_input = preprocess_input(np.expand_dims(raw_arr.copy(), axis=0))
    base_pred  = model.predict(base_input, verbose=0)[0]

    # TTA predictions
    tta_preds = [base_pred]
    for _ in range(TTA_STEPS - 1):
        aug_pred = model.predict(augment_and_preprocess(raw_arr), verbose=0)[0]
        tta_preds.append(aug_pred)

    # Average all predictions
    return np.mean(tta_preds, axis=0)


#  MAIN ENDPOINT 
@app.post("/predict")
async def predict(file: UploadFile = File(...)):

    # Read uploaded image
    image_bytes = await file.read()

    #  Predict with TTA 
    predictions = predict_with_tta(image_bytes)

    #  Get best class
    best_idx   = str(np.argmax(predictions))
    best_label = class_indices.get(best_idx, "Unknown")
    confidence = float(np.max(predictions))

    #  Return response
    return {
        "predicted_class" : format_label(best_label),  
        "confidence"      : round(confidence * 100, 2),
    }


#  Run
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
    