import os
import numpy as np
import tensorflow as tf
from tensorflow.keras import Model
from tensorflow.keras.layers import (Dense, Dropout, GlobalAveragePooling2D, BatchNormalization)
from tensorflow.keras.callbacks import (EarlyStopping, ModelCheckpoint, ReduceLROnPlateau, CSVLogger)
from sklearn.utils.class_weight import compute_class_weight


#  Config
EPOCHS          = 30
LEARNING_RATE   = 5e-5
WEIGHT_DECAY    = 1e-4
BATCH_SIZE      = 32
IMG_SIZE        = (224, 224)
NUM_CLASSES     = 23
UNFREEZE_LAYERS = 50

DATASET_PATH  = r"D:\Custom_dataset"
TRAINED_MODEL = r"D:\Custom_dataset\Output\mobilenetv2_final.keras"
MODEL_SAVE    = r"D:\Custom_dataset\Output\mobilenetv2_unfreeze50_best.keras"
LOG_FILE      = r"D:\Custom_dataset\Output\unfreeze50_log.csv"

os.makedirs(r"D:\Custom_dataset\Output", exist_ok=True)

TRAIN_PATH = os.path.join(DATASET_PATH, "train")
VAL_PATH   = os.path.join(DATASET_PATH, "val")



#  Preprocessing and Augmentation
def load_and_preprocess(path, label):
    img = tf.io.read_file(path)
    img = tf.image.decode_jpeg(img, channels=3)
    img = tf.image.resize(img, IMG_SIZE)
    img = tf.keras.applications.mobilenet_v2.preprocess_input(img)
    # img is now in [-1, 1] range
    return img, label


def augment(img, label):
    # Flips
    img = tf.image.random_flip_left_right(img)
    img = tf.image.random_flip_up_down(img)

    # brightness jitter in [-0.1, 0.1]
    img = img + tf.random.uniform([], -0.1, 0.1)
    img = tf.clip_by_value(img, -1.0, 1.0)

    # Random resize and crop
    img = tf.image.resize(img, [260, 260])               
    img = tf.image.random_crop(img, size=[224, 224, 3])  

    # Random contrast in [-1,1] space
    img = tf.image.random_contrast(img, lower=0.8, upper=1.2)
    img = tf.clip_by_value(img, -1.0, 1.0)

    return img, label


def make_dataset(image_dir, training=False):
    class_names   = sorted(os.listdir(image_dir))
    class_indices = {name: i for i, name in enumerate(class_names)}

    paths, labels = [], []
    for class_name in class_names:
        class_dir = os.path.join(image_dir, class_name)
        if not os.path.isdir(class_dir):
            continue
        for fname in os.listdir(class_dir):
            if fname.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(class_dir, fname))
                label = [0] * NUM_CLASSES
                label[class_indices[class_name]] = 1
                labels.append(label)

    ds = tf.data.Dataset.from_tensor_slices(
        (paths, tf.cast(labels, tf.float32))
    )
    if training:
        ds = ds.shuffle(buffer_size=len(paths), seed=42)
    ds = ds.map(load_and_preprocess, num_parallel_calls=tf.data.AUTOTUNE)
    if training:
        ds = ds.map(augment, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)
    return ds, class_indices, len(paths)


print("\n  Building datasets...")
train_ds, class_indices, n_train = make_dataset(TRAIN_PATH, training=True)
val_ds,   _,             n_val   = make_dataset(VAL_PATH,   training=False)
print(f"  Train   : {n_train} images")
print(f"  Val     : {n_val}   images")
print(f"  Classes : {NUM_CLASSES}")



#  Class Weights
all_labels = []
for class_name in sorted(os.listdir(TRAIN_PATH)):
    class_dir = os.path.join(TRAIN_PATH, class_name)
    if os.path.isdir(class_dir):
        count = len([
            f for f in os.listdir(class_dir)
            if f.lower().endswith((".jpg", ".jpeg", ".png"))
        ])
        all_labels.extend([class_indices[class_name]] * count)

all_labels    = np.array(all_labels)
cw            = compute_class_weight("balanced", classes=np.unique(all_labels), y=all_labels)
class_weights = dict(enumerate(cw))
print(f"\n  Class weights computed for {len(class_weights)} classes")



#  Load Trained Model
print(f"\n  Loading trained model...")
print(f"  {TRAINED_MODEL}")
old_model = tf.keras.models.load_model(TRAINED_MODEL)
print(f"  Model loaded")

# Find MobileNetV2 base inside model
base_model = None
for layer in old_model.layers:
    if isinstance(layer, tf.keras.Model):
        base_model = layer
        break

print(f"\n  Last 10 base layers:")
if base_model:
    for layer in base_model.layers[-10:]:
        print(f"    {layer.name}")

# Cut at out_relu
base_output = old_model.get_layer("out_relu").output
print(f"\n  Base cut at : out_relu")



#  Build New Head
x = base_output
x = GlobalAveragePooling2D(name="new_gap")(x)

x = Dense(512, activation="relu", name="new_dense_512")(x)
x = BatchNormalization(            name="new_bn_512")(x)
x = Dropout(0.2,                   name="new_drop_512")(x)   

x = Dense(256, activation="relu", name="new_dense_256")(x)
x = BatchNormalization(            name="new_bn_256")(x)
x = Dropout(0.1,                   name="new_drop_256")(x)  

output = Dense(NUM_CLASSES, activation="softmax", name="new_predictions")(x)

model = Model(inputs=old_model.input, outputs=output)

# Freeze everything first
for layer in model.layers:
    layer.trainable = False

# Unfreeze last 50 backbone layers
if base_model:
    for layer in base_model.layers[-UNFREEZE_LAYERS:]:
        layer.trainable = True

# Unfreeze all new head layers
NEW_HEAD_LAYERS = [
    "new_gap",
    "new_dense_512", "new_bn_512",  "new_drop_512",
    "new_dense_256", "new_bn_256",  "new_drop_256",
    "new_predictions"
]
for layer in model.layers:
    if layer.name in NEW_HEAD_LAYERS:
        layer.trainable = True



#  Summary
trainable_params = sum([tf.size(w).numpy() for w in model.trainable_weights])
frozen_params    = sum([tf.size(w).numpy() for w in model.non_trainable_weights])

print(f"\n  MODEL SUMMARY")
print(f"  Total layers      : {len(model.layers)}")
print(f"  Trainable layers  : {sum(1 for l in model.layers if l.trainable)}")
print(f"  Frozen layers     : {sum(1 for l in model.layers if not l.trainable)}")
print(f"  Trainable params  : {trainable_params:,}")
print(f"  Frozen params     : {frozen_params:,}")

print(f"\n  Trainable Backbone layers (last {UNFREEZE_LAYERS}):")
if base_model:
    for layer in base_model.layers[-UNFREEZE_LAYERS:]:
        print(f"    {layer.name}")

print(f"\n  Trainable Head layers:")
for name in NEW_HEAD_LAYERS:
    print(f"    {name}")

#  Callbacks
callbacks = [
    ModelCheckpoint(
        MODEL_SAVE,
        monitor="val_accuracy",      
        save_best_only=True,
        mode="max",                  
        verbose=1
    ),
    EarlyStopping(
        monitor="val_accuracy",      
        patience=8,
        restore_best_weights=True,
        mode="max",                 
        verbose=1
    ),
    ReduceLROnPlateau(
        monitor="val_loss",          
        factor=0.5,
        patience=3,
        min_lr=1e-8,
        verbose=1
    ),
    CSVLogger(LOG_FILE, append=False)
]



#  Compile
print(f"\n  Compiling | LR={LEARNING_RATE} | WeightDecay={WEIGHT_DECAY}")
model.compile(
    optimizer=tf.keras.optimizers.AdamW(
        learning_rate=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY
    ),
    loss="categorical_crossentropy",
    metrics=[
        "accuracy",
        tf.keras.metrics.TopKCategoricalAccuracy(k=3, name="top3_accuracy") 
    ]
)


#  Train
print(f"\n  Starting Training")
print(f"  Backbone last {UNFREEZE_LAYERS} layers + New head")
print(f"  Epochs={EPOCHS} | LR={LEARNING_RATE} | Batch={BATCH_SIZE}\n")

history = model.fit(
    train_ds,
    epochs=EPOCHS,
    validation_data=val_ds,
    class_weight=class_weights,
    callbacks=callbacks,
    verbose=1
)


#  Results
best_train_acc  = max(history.history["accuracy"])
best_val_acc    = max(history.history["val_accuracy"])
best_val_top3   = max(history.history["val_top3_accuracy"])
best_val_loss   = min(history.history["val_loss"])
train_val_gap   = best_train_acc - best_val_acc
epochs_ran      = len(history.history["accuracy"])

print(f"\n  FINAL RESULTS — Plant Disease {NUM_CLASSES} Classes")
print(f"  Best Train Accuracy   : {best_train_acc*100:.2f}%")
print(f"  Best Val Accuracy     : {best_val_acc*100:.2f}%")
print(f"  Best Val Top-3 Acc    : {best_val_top3*100:.2f}%")
print(f"  Best Val Loss         : {best_val_loss:.4f}")
print(f"  Train/Val Gap         : {train_val_gap*100:.2f}%  "
      f"{'Good' if train_val_gap < 0.08 else 'Slight overfit — consider more dropout'}")
print(f"  Total epochs ran      : {epochs_ran}/{EPOCHS}")
print(f"  Model saved → {MODEL_SAVE}")
print(f"  Log saved   → {LOG_FILE}")