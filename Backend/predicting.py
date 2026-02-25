import os
import numpy as np
import tensorflow as tf
from keras.applications.mobilenet_v2 import preprocess_input

IMAGE_TO_TEST = r"C:/Users/Varshitha/Downloads/KT-2019080504.jpg"
MODEL_PATH = 'D:/plant disease detection/mobilenet_plant_model.keras'

CLASS_NAMES = [
    'apple_scab', 'bacterial_spot', 'black_rot', 'cedar_apple_rust', 
    'cercospora_leaf_spot gray_leaf_spot', 'common_rust_', 'early_blight', 
    'healthy', 'late_blight', 'northern_leaf_blight', 'tomato__target_spot', 
    'tomato__tomato_mosaic_virus', 'tomato__tomato_yellowleaf__curl_virus', 
    'tomato_bacterial_spot', 'tomato_early_blight', 'tomato_healthy', 
    'tomato_late_blight', 'tomato_leaf_mold', 'tomato_septoria_leaf_spot', 
    'tomato_spider_mites_two_spotted_spider_mite'
]

# BUILD SKELETON & LOAD WEIGHTS 
def load_fixed_model():
    base_model = tf.keras.applications.MobileNetV2(weights=None, include_top=False, input_shape=(224, 224, 3))
    model = tf.keras.Sequential([
        base_model,
        tf.keras.layers.GlobalAveragePooling2D(),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dense(256, activation='relu'),
        tf.keras.layers.Dropout(0.5),
        tf.keras.layers.Dense(20, activation='softmax')
    ])
    model.load_weights(MODEL_PATH)
    return model

#  3. PREDICTION FUNCTION
def predict_single_image(img_path):
    print(f"Analyzing: {os.path.basename(img_path)}...")
    
    # Load and Preprocess
    img = tf.io.read_file(img_path)
    img = tf.image.decode_jpeg(img, channels=3)
    img = tf.image.resize(img, [224, 224], method='bilinear', antialias=True)
    img = preprocess_input(img) 
    img = np.expand_dims(img, axis=0) # Add batch dimension (1, 224, 224, 3)

    # Predict
    preds = model.predict(img, verbose=0)
    score = np.max(preds[0])
    class_idx = np.argmax(preds[0])
    
    return CLASS_NAMES[class_idx], score

#  RUN IT 
if __name__ == "__main__":
    if not os.path.exists(IMAGE_TO_TEST):
        print(f"ERROR: Cannot find the image at {IMAGE_TO_TEST}")
    else:
        model = load_fixed_model()
        label, confidence = predict_single_image(IMAGE_TO_TEST)
        
        print("-" * 30)
        print(f"PREDICTION: {label.upper()}")
        print(f"CONFIDENCE: {confidence * 100:.2f}%")
        print("-" * 30)