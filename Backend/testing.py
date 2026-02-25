import os
import tensorflow as tf
import keras
import numpy as np
import pandas as pd
from sklearn.metrics import classification_report

MODEL_PATH = 'D:/plant disease detection/mobilenet_plant_model.keras'
BASE_TEST_DIR = r"D:/Final_project_data/Test"
num_classes = 20 

# THE EXACT CLASS ORDER 
class_labels = [
    'apple_scab', 'bacterial_spot', 'black_rot', 'cedar_apple_rust', 
    'cercospora_leaf_spot gray_leaf_spot', 'common_rust_', 'early_blight', 
    'healthy', 'late_blight', 'northern_leaf_blight', 'tomato__target_spot', 
    'tomato__tomato_mosaic_virus', 'tomato__tomato_yellowleaf__curl_virus', 
    'tomato_bacterial_spot', 'tomato_early_blight', 'tomato_healthy', 
    'tomato_late_blight', 'tomato_leaf_mold', 'tomato_septoria_leaf_spot', 
    'tomato_spider_mites_two_spotted_spider_mite'
]

# RECONSTRUCT THE SKELETON
def build_model():
    base_model = keras.applications.MobileNetV2(weights=None, include_top=False, input_shape=(224, 224, 3))
    model = keras.Sequential([
        base_model,
        keras.layers.GlobalAveragePooling2D(),
        keras.layers.BatchNormalization(),
        keras.layers.Dense(256, activation='relu'),
        keras.layers.Dropout(0.5),
        keras.layers.Dense(num_classes, activation='softmax')
    ])
    return model

model = build_model()
model.load_weights(MODEL_PATH)
model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
print(" Model and weights loaded successfully.")

# DATA MAPPING (Merging Healthy Folders)
current_dir = os.path.dirname(os.path.abspath(__file__))
csv_path = os.path.join(current_dir, 'test_dataset.csv')
test_df = pd.read_csv(csv_path)

# Map your physical folder names to the model's 'healthy' label
healthy_folders = ['Apple___healthy', 'Corn_(maize)___healthy', 'Pepper__bell___healthy', 'Potato___healthy']

def map_label(label):
    if label in healthy_folders:
        return 'healthy'
    return label.lower().replace("___", "_").replace("__", "_")

test_df['model_label'] = test_df['label'].apply(map_label)

# PATH & PREPROCESSING 
def get_path(row):
    return os.path.join(BASE_TEST_DIR, str(row['label']), os.path.basename(row['image_path']))

test_df['full_path'] = test_df.apply(get_path, axis=1)

from keras.applications.mobilenet_v2 import preprocess_input

def preprocess(path, label_idx):
    img = tf.io.read_file(path)
    img = tf.image.decode_jpeg(img, channels=3)
    img = tf.image.resize(img, [224, 224], method='bilinear', antialias=True)
    # Replace img / 255.0 with this:
    img = preprocess_input(img) 
    return img, tf.one_hot(label_idx, num_classes)

label_to_index = {name: i for i, name in enumerate(class_labels)}
test_df = test_df[test_df['model_label'].isin(class_labels)]
y_true_indices = test_df['model_label'].map(label_to_index).values

test_ds = tf.data.Dataset.from_tensor_slices((test_df['full_path'].values, y_true_indices))
test_ds = test_ds.map(preprocess).batch(32).prefetch(tf.data.AUTOTUNE)

# EVALUATE 
print("\n--- Final Test Accuracy ---")
loss, accuracy = model.evaluate(test_ds)
print(f" Accuracy: {accuracy * 100:.2f}%")