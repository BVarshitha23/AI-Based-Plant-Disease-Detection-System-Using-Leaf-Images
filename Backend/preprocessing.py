import pandas as pd
import numpy as np
import cv2
import os

from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split

IMG_SIZE = 224
CSV_PATH = "D:/plant disease detection/CSV_Files/all_images.csv"

df = pd.read_csv(CSV_PATH)
df = df[:1000]

print("Total samples:", len(df))

images = []
labels = []

for index, row in df.iterrows():
    img_path = row["filepath"]
    label = row["label"]

    # Read image
    img = cv2.imread(img_path)

    if img is None:
        print("Image not found:", img_path)
        continue

    # Convert BGR to RGB
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Resize
    img = cv2.resize(img, (IMG_SIZE, IMG_SIZE))

    # Normalize
    img = img / 255.0

    images.append(img)
    labels.append(label)

# Convert to numpy array
X = np.array(images)
y = np.array(labels)

print("Image shape:", X.shape)

# Encode Labels
label_encoder = LabelEncoder()
y_encoded = label_encoder.fit_transform(y)

print("classes:", label_encoder.classes_)
print("Encoded labels:", y_encoded[:10])

print("Total Classes:", len(np.unique(y_encoded)))

#train test split
x_train, x_test, y_train, y_test = train_test_split(X, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded)

print(x_train.shape, y_train.shape)
print(x_test.shape, y_test.shape)