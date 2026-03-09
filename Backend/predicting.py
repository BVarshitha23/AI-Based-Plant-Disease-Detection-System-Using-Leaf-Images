import numpy as np
import json
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing import image
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

MODEL_PATH = r"D:\AI-Based-Plant-Disease-Detection-System-Using-Leaf-Images\mobilenet_plant_model_finetuned.keras"
JSON_PATH = "class_labels.json" 
IMAGE_PATH = r"C:\Users\Varshitha\Downloads\D869_27_632_1200.jpg"
CONFIDENCE_THRESHOLD = 0.5 

#  LOAD MODEL & LABELS
model = load_model(MODEL_PATH)
with open(JSON_PATH, 'r') as f:
    class_indices = json.load(f)

#  PREPROCESS IMAGE
def predict_plant_disease(img_path):
    # Load and resize
    img = image.load_img(img_path, target_size=(224, 224))
    img_array = image.img_to_array(img)
    img_array = np.expand_dims(img_array, axis=0) 
    img_array = preprocess_input(img_array)       

    #  PREDICT
    predictions = model.predict(img_array)
    predicted_index = str(np.argmax(predictions))
    confidence = np.max(predictions)

    #  GET LABEL
    predicted_label = class_indices.get(predicted_index, "Unknown Class")

    return predicted_label, confidence

#  EXECUTION
label, conf = predict_plant_disease(IMAGE_PATH)

if conf > CONFIDENCE_THRESHOLD:
    print(f"Prediction: {label}")
    print(f"Confidence: {conf * 100:.2f}%")
else:
    print(f"Prediction: {label} (Low Confidence)")
    print(f"Result: Unsure (Confidence only {conf * 100:.2f}%)")