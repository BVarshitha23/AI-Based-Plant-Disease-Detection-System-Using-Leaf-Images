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


#  CONFIG 
TRAIN_DIR   = r"D:\Datasets\balanced_dataset\train"
VAL_DIR     = r"D:\Datasets\balanced_dataset\val"
OUTPUT_DIR  = r"D:\Datasets\Output"

IMG_SIZE    = (224, 224)
BATCH_SIZE  = 32
NUM_CLASSES = 23        
EPOCHS_HEAD = 15        
EPOCHS_FINE = 30        

os.makedirs(OUTPUT_DIR, exist_ok=True)

#  DATA GENERATORS
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
    val_datagen = ImageDataGenerator(preprocessing_function=preprocess_input)

    train_gen = train_datagen.flow_from_directory(
        TRAIN_DIR, target_size=IMG_SIZE,
        batch_size=BATCH_SIZE, class_mode='categorical', shuffle=True
    )
    val_gen = val_datagen.flow_from_directory(
        VAL_DIR, target_size=IMG_SIZE,
        batch_size=BATCH_SIZE, class_mode='categorical', shuffle=False
    )
    return train_gen, val_gen

#  CLASS WEIGHTS
def get_class_weights(train_gen):
    classes = np.unique(train_gen.classes)
    weights = compute_class_weight('balanced', classes=classes, y=train_gen.classes)
    cw_dict = dict(enumerate(weights))
    print(f"\n Class weights computed for {len(cw_dict)} classes")
    for idx, w in cw_dict.items():
        label = {v: k for k, v in train_gen.class_indices.items()}[idx]
        print(f"   Class {idx:2d} | {label:<40} | weight: {w:.3f}")
    return cw_dict

#  BUILD MODEL
def build_model():
    print("\n Building MobileNetV2 model...")
    base = MobileNetV2(
        weights='imagenet',
        include_top=False,
        input_shape=(224, 224, 3)
    )
    base.trainable = False  # freeze for Phase 1

    x   = base.output
    x   = GlobalAveragePooling2D()(x)
    x   = BatchNormalization()(x)
    x   = Dense(512, activation='relu')(x)
    x   = Dropout(0.2)(x)
    x   = Dense(256, activation='relu')(x)
    x   = Dropout(0.1)(x)
    out = Dense(NUM_CLASSES, activation='softmax')(x)

    model = Model(inputs=base.input, outputs=out)
    print(f"   Model built | Total params: {model.count_params():,}")
    return model, base

#  CALLBACKS
def make_callbacks(phase):
    return [
        EarlyStopping(
            monitor='val_accuracy', patience=5,
            restore_best_weights=True, verbose=1
        ),
        ReduceLROnPlateau(
            monitor='val_loss', factor=0.3,
            patience=3, min_lr=1e-7, verbose=1
        ),
        ModelCheckpoint(
            filepath=os.path.join(OUTPUT_DIR, f"mobilenetv2_phase{phase}_best.keras"),
            monitor='val_accuracy', save_best_only=True, verbose=1
        )
    ]

#  PHASE 1 — Train Head Only
def train_phase1(model, train_gen, val_gen, class_weights):
    print(" PHASE 1 — Training head only")

    model.compile(
        optimizer=Adam(learning_rate=1e-3),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    history = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=EPOCHS_HEAD,
        class_weight=class_weights,
        callbacks=make_callbacks(1),
        verbose=1
    )
    print(f"\n Phase 1 complete | Best val_accuracy: {max(history.history['val_accuracy'])*100:.2f}%")
    return history

#  PHASE 2 — Fine-tune Top Layers
def train_phase2(model, base_model, train_gen, val_gen, class_weights):
    print(" PHASE 2 — Fine-tuning top 50 layers")

    # Unfreeze last 50 layers of base model
    base_model.trainable = True
    for layer in base_model.layers[:-50]:
        layer.trainable = False

    trainable = sum(1 for l in model.layers if l.trainable)
    print(f"  Trainable layers: {trainable}")

    model.compile(
        optimizer=Adam(learning_rate=1e-5),   
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    history = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=EPOCHS_FINE,
        class_weight=class_weights,
        callbacks=make_callbacks(2),
        verbose=1
    )
    print(f"\n Phase 2 complete | Best val_accuracy: {max(history.history['val_accuracy'])*100:.2f}%")
    return history

#  SAVE CLASS LABELS
def save_class_labels(train_gen):
    index_to_label = {str(v): k for k, v in train_gen.class_indices.items()}
    path = os.path.join(OUTPUT_DIR, "class_labels.json")
    with open(path, "w") as f:
        json.dump(index_to_label, f, indent=2)
    print(f"\n class_labels.json saved → {path}")

#  PLOT TRAINING HISTORY
def plot_history(h1, h2):
    acc     = h1.history['accuracy']     + h2.history['accuracy']
    val_acc = h1.history['val_accuracy'] + h2.history['val_accuracy']
    loss    = h1.history['loss']         + h2.history['loss']
    val_los = h1.history['val_loss']     + h2.history['val_loss']
    split   = len(h1.history['accuracy'])

    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle('MobileNetV2 — Training History', fontsize=14, fontweight='bold')

    for ax, train_vals, val_vals, title in [
        (axes[0], acc, val_acc, 'Accuracy'),
        (axes[1], loss, val_los, 'Loss')
    ]:
        ax.plot(train_vals, label='Train', color='blue')
        ax.plot(val_vals,   label='Val',   color='orange')
        ax.axvline(x=split, color='red', linestyle='--', label='Fine-tune start')
        ax.set_title(title)
        ax.set_xlabel('Epoch')
        ax.legend()
        ax.grid(True, alpha=0.3)

    plt.tight_layout()
    save_path = os.path.join(OUTPUT_DIR, "training_history.png")
    plt.savefig(save_path, dpi=150, bbox_inches='tight')
    print(f" Training plot saved → {save_path}")
    plt.show()

#  MAIN
if __name__ == "__main__":
    train_gen, val_gen = create_generators()
    save_class_labels(train_gen)
    class_weights      = get_class_weights(train_gen)
    model, base_model  = build_model()

    h1 = train_phase1(model, train_gen, val_gen, class_weights)
    h2 = train_phase2(model, base_model, train_gen, val_gen, class_weights)

    # Save final model
    final_path = os.path.join(OUTPUT_DIR, "mobilenetv2_final.keras")
    model.save(final_path)
    print(f"\n Final model saved → {final_path}")

    plot_history(h1, h2)

    best_val = max(h1.history['val_accuracy'] + h2.history['val_accuracy'])
    print(f"\n Best val_accuracy achieved: {best_val*100:.2f}%")