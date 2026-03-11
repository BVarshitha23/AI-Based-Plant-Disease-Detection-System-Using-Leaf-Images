import numpy as np
import json
import cv2
import matplotlib.pyplot as plt
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import load_img, img_to_array
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

#  CONFIG

MODEL_PATH           = r"D:\Datasets\Output\mobilenetv2_final.keras"
JSON_PATH            = r"D:\Datasets\Output\class_labels.json"
IMAGE_PATH           = r"C:\Users\Varshitha\Downloads\310a.jpg"
IMG_SIZE             = (224, 224)
CONFIDENCE_THRESHOLD = 0.50
TTA_STEPS            = 10


#  LOAD MODEL & LABELS
print(" PLANT DISEASE PREDICTION")

model = load_model(MODEL_PATH)
with open(JSON_PATH, 'r') as f:
    class_indices = json.load(f)
print(f"{len(class_indices)} classes loaded")



#  HELPERS
def format_label(label: str) -> str:
    # Convert "Tomato___Bacterial_spot" → "Tomato - Bacterial Spot"
    return label.replace("___", " - ").replace("_", " ").title()


def load_raw(img_path: str) -> np.ndarray:
    img = load_img(img_path, target_size=IMG_SIZE)
    return img_to_array(img)   # raw [0, 255]


def augment_and_preprocess(raw_arr: np.ndarray) -> np.ndarray:
    img = raw_arr.copy()

    # Augment on raw [0, 255] pixels
    img += np.random.uniform(-20, 20)
    img  = np.clip(img, 0, 255)

    if np.random.rand() > 0.5:
        img = np.fliplr(img)

    k   = np.random.randint(0, 4)
    img = np.rot90(img, k)

    h, w   = img.shape[:2]
    margin = int(h * 0.10)
    if margin > 0:
        top  = np.random.randint(0, margin)
        left = np.random.randint(0, margin)
        img  = img[top:h - margin + top, left:w - margin + left]
        img  = cv2.resize(img, (w, h))

    # preprocess AFTER augmentation — MobileNetV2 scales to [-1, 1]
    img = np.expand_dims(img, axis=0)
    img = preprocess_input(img)
    return img



#  PREDICT WITH TTA
def predict(img_path: str):
    raw_arr = load_raw(img_path)

    # Base prediction
    base_input = preprocess_input(np.expand_dims(raw_arr.copy(), axis=0))
    base_pred  = model.predict(base_input, verbose=0)[0]

    # TTA predictions
    tta_preds = [base_pred]
    for _ in range(TTA_STEPS - 1):
        aug_pred = model.predict(augment_and_preprocess(raw_arr), verbose=0)[0]
        tta_preds.append(aug_pred)

    # Average all TTA predictions
    return np.mean(tta_preds, axis=0)

#  RUN PREDICTION

print(f"\n Image : {IMAGE_PATH.split(chr(92))[-1]}")
print(" Predicting...\n")

predictions = predict(IMAGE_PATH)

# Top 5 results
top5 = np.argsort(predictions)[::-1][:5]
print("  Top 5 Predictions:")

for rank, idx in enumerate(top5, 1):
    label  = format_label(class_indices.get(str(idx), "Unknown"))
    conf   = predictions[idx] * 100
    bar    = "█" * int(conf // 4)
    marker = "  ← BEST" if rank == 1 else ""
    print(f"  {rank}. {label:<40} {conf:5.1f}%  {bar}{marker}")
print("─" * 58)

# Final verdict
best_idx   = str(np.argmax(predictions))
best_label = format_label(class_indices.get(best_idx, "Unknown"))
best_conf  = float(np.max(predictions))

print()
if best_conf >= CONFIDENCE_THRESHOLD:
    print(f"PREDICTED DISEASE : {best_label}")
    print(f"   CONFIDENCE        : {best_conf * 100:.2f}%")
else:
    print(f"  LOW CONFIDENCE ({best_conf*100:.2f}%) — model is unsure")
    print(f"   Best guess : {best_label}")
    print(f"\n    Tips for better prediction:")
    print(f"      • Use a clear, close-up image of the leaf")
    print(f"      • Leaf should fill most of the frame")
    print(f"      • Good lighting, no heavy shadows")
    print(f"      • Avoid watermarks or text in image")


#  SHOW IMAGE WITH RESULT
img   = load_img(IMAGE_PATH, target_size=IMG_SIZE)
color = 'green' if best_conf >= CONFIDENCE_THRESHOLD else 'orange'

plt.figure(figsize=(5, 5))
plt.imshow(img)
plt.axis('off')
plt.title(
    f"Predicted: {best_label}\nConfidence: {best_conf*100:.1f}%",
    fontsize=10, color=color, fontweight='bold', pad=12
)
plt.tight_layout()
plt.show()