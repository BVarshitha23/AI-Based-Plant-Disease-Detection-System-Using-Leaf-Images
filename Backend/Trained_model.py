import os
import json
import numpy as np
import matplotlib.pyplot as plt

import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import GlobalAveragePooling2D, Dense, Dropout, BatchNormalization
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from sklearn.utils.class_weight import compute_class_weight


# CONFIG
TRAIN_DIR   = r"D:\Custom_dataset\train"
VAL_DIR     = r"D:\Custom_dataset\val"
OUTPUT_DIR  = r"D:\Custom_dataset\Output"

IMG_SIZE    = (224, 224)
BATCH_SIZE  = 32
NUM_CLASSES = 23
EPOCHS      = 15

os.makedirs(OUTPUT_DIR, exist_ok=True)



# DATA GENERATORS
def create_generators():
    train_datagen = ImageDataGenerator(
        preprocessing_function=preprocess_input,
        rotation_range=40,
        width_shift_range=0.2,
        height_shift_range=0.2,
        shear_range=0.2,
        zoom_range=0.3,
        brightness_range=[0.5, 1.5],
        horizontal_flip=True,
        vertical_flip=True,
        fill_mode='reflect'
    )
    val_datagen = ImageDataGenerator(
        preprocessing_function=preprocess_input
    )

    train_gen = train_datagen.flow_from_directory(
        TRAIN_DIR,
        target_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        shuffle=True
    )
    val_gen = val_datagen.flow_from_directory(
        VAL_DIR,
        target_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        class_mode='categorical',
        shuffle=False
    )
    return train_gen, val_gen


# CLASS WEIGHTS
def get_class_weights(train_gen):
    classes = np.unique(train_gen.classes)
    weights = compute_class_weight('balanced', classes=classes, y=train_gen.classes)
    cw_dict = dict(enumerate(weights))
    print(f"\nClass weights computed for {len(cw_dict)} classes")
    for idx, w in cw_dict.items():
        label = {v: k for k, v in train_gen.class_indices.items()}[idx]
        print(f"  Class {idx:2d} | {label:<45} | weight: {w:.3f}")
    return cw_dict



# BUILD MODEL
def build_model():
    print("\nBuilding MobileNetV2 model...")
    base = MobileNetV2(
        weights='imagenet',
        include_top=False,
        input_shape=(224, 224, 3)
    )
    base.trainable = False  # freeze entire backbone

    x   = base.output
    x   = GlobalAveragePooling2D()(x)
    x   = BatchNormalization()(x)
    x   = Dense(512, activation='relu')(x)
    x   = Dropout(0.2)(x)
    x   = Dense(256, activation='relu')(x)
    x   = Dropout(0.1)(x)
    out = Dense(NUM_CLASSES, activation='softmax')(x)

    model = Model(inputs=base.input, outputs=out)
    print(f"  Model built | Total params: {model.count_params():,}")
    return model



# CALLBACKS
def make_callbacks():
    return [
        EarlyStopping(
            monitor='val_accuracy',
            patience=5,
            restore_best_weights=True,
            verbose=1
        ),
        ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.3,
            patience=3,
            min_lr=1e-7,
            verbose=1
        ),
        ModelCheckpoint(
            filepath=os.path.join(OUTPUT_DIR, "mobilenetv2_best.keras"),
            monitor='val_accuracy',
            save_best_only=True,
            verbose=1
        )
    ]



# TRAINING
def train_model(model, train_gen, val_gen, class_weights):
    print(f"\n{'='*50}")
    print("  TRAINING ")
    print(f"{'='*50}")

    model.compile(
        optimizer=Adam(learning_rate=1e-3),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )

    history = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=EPOCHS,
        class_weight=class_weights,
        callbacks=make_callbacks(),
        verbose=1
    )

    best_val = max(history.history['val_accuracy']) * 100
    print(f"\n  Training complete!")
    print(f"  Best val_accuracy: {best_val:.2f}%")
    return history

# SAVE CLASS LABELS
def save_class_labels(train_gen):
    index_to_label = {str(v): k for k, v in train_gen.class_indices.items()}
    path = os.path.join(OUTPUT_DIR, "class_labels.json")
    with open(path, "w") as f:
        json.dump(index_to_label, f, indent=2)
    print(f"\n  class_labels.json saved → {path}")



# PLOT TRAINING HISTORY
def plot_history(history):
    acc     = history.history['accuracy']
    val_acc = history.history['val_accuracy']
    loss    = history.history['loss']
    val_los = history.history['val_loss']

    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle('MobileNetV2 — Training History', fontsize=14, fontweight='bold')

    axes[0].plot([a * 100 for a in acc],     label='Train', color='blue')
    axes[0].plot([a * 100 for a in val_acc], label='Val',   color='orange')
    axes[0].set_title('Accuracy')
    axes[0].set_xlabel('Epoch')
    axes[0].set_ylabel('Accuracy (%)')
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)

    axes[1].plot(loss,    label='Train', color='blue')
    axes[1].plot(val_los, label='Val',   color='orange')
    axes[1].set_title('Loss')
    axes[1].set_xlabel('Epoch')
    axes[1].set_ylabel('Loss')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    save_path = os.path.join(OUTPUT_DIR, "training_history.png")
    plt.savefig(save_path, dpi=150, bbox_inches='tight')
    print(f"  Training plot saved → {save_path}")
    plt.show()



# MAIN
if __name__ == "__main__":

    # Step 1 — Load data
    train_gen, val_gen = create_generators()

    # Step 2 — Save class labels
    save_class_labels(train_gen)

    # Step 3 — Class weights
    class_weights = get_class_weights(train_gen)

    # Step 4 — Build model
    model = build_model()

    # Step 5 — Train
    history = train_model(model, train_gen, val_gen, class_weights)

    # Step 6 — Save final model
    final_path = os.path.join(OUTPUT_DIR, "mobilenetv2_final.keras")
    model.save(final_path)
    print(f"\n  Final model saved → {final_path}")

    # Step 7 — Plot
    plot_history(history)

    print(f"\n  Best val_accuracy : {max(history.history['val_accuracy'])*100:.2f}%")