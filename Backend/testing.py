import tensorflow as tf
import numpy as np
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from sklearn.metrics import classification_report


TEST_DIR = r"D:\Datasets\balanced_dataset\test"
MODEL_PATH = r"D:\fastapi practice\Backend\mobilenet_plant_model_finetuned.keras"
IMG_SIZE = (224, 224)
BATCH_SIZE = 32

# LOAD MODEL
model = load_model(MODEL_PATH)

# TEST DATA GENERATOR
test_datagen = ImageDataGenerator(
    preprocessing_function=preprocess_input
)

test_generator = test_datagen.flow_from_directory(
    TEST_DIR,
    target_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    class_mode='categorical',
    shuffle=False  
)
class_names = list(test_generator.class_indices.keys())
print(class_names)

# EVALUATE MODEL
loss, accuracy = model.evaluate(test_generator)
print(f"\nTest Loss: {loss:.4f}")
print(f"Test Accuracy: {accuracy:.4f}")


# DETAILED METRICS
predictions = model.predict(test_generator)
y_pred = np.argmax(predictions, axis=1)
y_true = test_generator.classes

class_labels = list(test_generator.class_indices.keys())

print("\nClassification Report:")
print(classification_report(y_true, y_pred, target_names=class_labels))

