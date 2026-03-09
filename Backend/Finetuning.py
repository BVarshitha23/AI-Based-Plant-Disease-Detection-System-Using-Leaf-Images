import tensorflow as tf
import numpy as np
import json
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from sklearn.utils.class_weight import compute_class_weight

# PATHS 
MODEL_PATH = r"D:\fastapi practice\Backend\mobilenet_plant_model.keras"
TRAIN_DIR  = r"D:\Datasets\balanced_dataset\train"
VAL_DIR    = r"D:\Datasets\balanced_dataset\val"
SAVE_PATH  = r"D:\fastapi practice\Backend\mobilenet_plant_model_finetuned.keras"
IMG_SIZE   = (224, 224)
BATCH_SIZE = 32

#  LOAD MODEL 
print("Loading saved model...")
model = load_model(MODEL_PATH)

#  INSPECT LAYERS 
print(f"\nTotal layers in model: {len(model.layers)}")
for i, layer in enumerate(model.layers):
    print(f"  [{i}] {layer.name} — trainable: {layer.trainable}")

#  UNFREEZE LAST 60 LAYERS OF THE FLAT MODEL
# Exclude last 3 layers (GAP, Dropout, Dense) — those are your custom head
total_layers = len(model.layers)
head_layers  = 3   # GlobalAveragePooling2D, Dropout, Dense

# Freeze all first
for layer in model.layers:
    layer.trainable = False

# Unfreeze last 60 backbone layers (excluding the head)
backbone_layers = model.layers[:-head_layers]   # all except GAP/Dropout/Dense
unfreeze_from   = max(0, len(backbone_layers) - 60)

for layer in backbone_layers[unfreeze_from:]:
    layer.trainable = True

# Always keep head trainable
for layer in model.layers[-head_layers:]:
    layer.trainable = True

# Verify
trainable_count = sum(1 for l in model.layers if l.trainable)
print(f"\nTrainable layers : {trainable_count} / {total_layers}")
print(f"Unfreezing from  : layer index {unfreeze_from} → '{model.layers[unfreeze_from].name}'")

#  RECOMPILE
model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
    loss='categorical_crossentropy',
    metrics=['accuracy']
)

#  DATA GENERATORS 
train_datagen = ImageDataGenerator(
    preprocessing_function=preprocess_input,
    rotation_range=30,
    width_shift_range=0.15,
    height_shift_range=0.15,
    zoom_range=0.25,
    horizontal_flip=True,
    vertical_flip=True,
    brightness_range=[0.7, 1.3],
    shear_range=0.1,
    fill_mode='nearest'
)

val_datagen = ImageDataGenerator(preprocessing_function=preprocess_input)

train_generator = train_datagen.flow_from_directory(
    TRAIN_DIR,
    target_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    class_mode='categorical',
    shuffle=True,
    seed=42
)

val_generator = val_datagen.flow_from_directory(
    VAL_DIR,
    target_size=IMG_SIZE,
    batch_size=BATCH_SIZE,
    class_mode='categorical',
    shuffle=False
)

# CLASS WEIGHTS 
class_weights = compute_class_weight(
    class_weight='balanced',
    classes=np.unique(train_generator.classes),
    y=train_generator.classes
)
class_weights = dict(enumerate(class_weights))

# CALLBACKS 
callbacks = [
    EarlyStopping(patience=4, restore_best_weights=True, verbose=1),
    ReduceLROnPlateau(patience=2, factor=0.3, verbose=1, min_lr=1e-7),
    ModelCheckpoint(SAVE_PATH, save_best_only=True, verbose=1)
]

#  FINE-TUNE 
print("\nStarting fine-tuning...")
history = model.fit(
    train_generator,
    validation_data=val_generator,
    epochs=10,
    class_weight=class_weights,
    callbacks=callbacks
)

# SAVE LABELS
labels = {str(v): k for k, v in train_generator.class_indices.items()}
with open(r"D:\fastapi practice\Backend\class_labels.json", 'w') as f:
    json.dump(labels, f, indent=4)

print(f"\nDone! Fine-tuned model saved to: {SAVE_PATH}")