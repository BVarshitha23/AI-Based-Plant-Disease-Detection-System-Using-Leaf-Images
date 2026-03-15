import numpy as np
import json
import cv2
import matplotlib.pyplot as plt
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import load_img, img_to_array
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input


#  CONFIG
MODEL_PATH           = r"D:\Custom_dataset\Output\mobilenetv2_unfreeze50_best.keras"
JSON_PATH            = r"D:\Custom_dataset\Output\class_labels.json"
IMAGE_PATH           = r"C:\Users\Varshitha\Downloads\New folder\Apple_healthy.jpg"
IMG_SIZE             = (224, 224)
TTA_STEPS            = 5

#LOAD MODEL 
model = load_model(MODEL_PATH)

with open(JSON_PATH, 'r') as f:
    class_indices = json.load(f)

print(f" {len(class_indices)} classes loaded\n")

#  HELPERS
def format_label(label: str) -> str:
    return label.replace("___", " - ").replace("_", " ").title()

def load_raw(img_path: str) -> np.ndarray:
    img = load_img(img_path, target_size=IMG_SIZE)
    return img_to_array(img)

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

#  PREDICT WITH TTA
def predict(img_path: str) -> np.ndarray:
    raw_arr = load_raw(img_path)

    base_input = preprocess_input(np.expand_dims(raw_arr.copy(), axis=0))
    base_pred  = model.predict(base_input, verbose=0)[0]

    tta_preds = [base_pred]
    for step in range(TTA_STEPS - 1):
        aug_pred = model.predict(augment_and_preprocess(raw_arr), verbose=0)[0]
        tta_preds.append(aug_pred)
        print(f"   TTA step {step + 2}/{TTA_STEPS} done...", end="\r")

    print(" " * 40, end="\r")
    return np.mean(tta_preds, axis=0)

#  RUN PREDICTION
img_name = IMAGE_PATH.replace("\\", "/").split("/")[-1]
print(f"  Image   : {img_name}")
print("   Predicting...\n")

predictions = predict(IMAGE_PATH)

best_idx   = str(np.argmax(predictions))
best_label = format_label(class_indices.get(best_idx, "Unknown"))
best_conf  = float(np.max(predictions))

#  RESULT
print("─" * 58)
print(f" PREDICTED DISEASE  : {best_label}")
print(f" CONFIDENCE         : {best_conf * 100:.2f}%")
print("─" * 58)

#  SHOW IMAGE WITH RESULT
img   = load_img(IMAGE_PATH, target_size=IMG_SIZE)
plt.figure(figsize=(5, 5))
plt.imshow(img)
plt.axis('off')
plt.title(
    f"Predicted: {best_label}\nConfidence: {best_conf * 100:.1f}%",
    fontsize=10, color='green', fontweight='bold', pad=12
)
plt.tight_layout()
plt.show()