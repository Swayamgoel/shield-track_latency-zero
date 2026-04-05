import pandas as pd
import numpy as np
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.ensemble import GradientBoostingRegressor
df = pd.read_csv("training_data.csv")
df
X = df.drop(["eta", "route_total"], axis=1)   
y = df["eta"]               
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
model = GradientBoostingRegressor(
    n_estimators=300,      # number of trees — more = more accurate but slower
    max_depth=5,           # how deep each tree goes — 5 is a good default
    learning_rate=0.05,    # smaller = slower learning but more stable
    min_samples_leaf=10,   # prevents overfitting on tiny subgroups
    random_state=42,
)
model.fit(X_train, y_train)
y_pred = model.predict(X_test)
y_pred
mae  = mean_absolute_error(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))
r2   = r2_score(y_test, y_pred)

print(f"\n  Mean Absolute Error (MAE):  {mae:.2f} minutes")
print(f"  Root Mean Squared Error:    {rmse:.2f} minutes")
print(f"  R² Score:                   {r2:.4f}")
print(f"\n  → On average, predictions are off by {mae:.1f} minute(s).")
print(f"  → R² of {r2:.2f} means the model explains {r2*100:.0f}% of ETA variance.")
errors = np.abs(y_pred - y_test.values)
confidence_scores = np.clip(1 - (errors / 10), 0, 1) * 100
print(f"\n  Average confidence score: {confidence_scores.mean():.1f}%")
importances = pd.Series(model.feature_importances_, index=X.columns)
importances = importances.sort_values(ascending=False)

print("\nFeature importances (which inputs matter most):")
for feat, imp in importances.items():
    bar = "█" * int(imp * 40)
    print(f"  {feat:<30} {imp:.3f}  {bar}")

scenarios = [
    {
        "label": "Peak hour, 3 km left, 2 stops",
        "features": [18, 17, 3.0, 2, 8, 1, 1, 3.5, 70.0, 8.5, 0.8],
    },
    {
        "label": "Off-peak, 8 km left, 5 stops",
        "features": [32, 30, 8.0, 5, 11, 2, 0, 0.5, 20.0, 12.0, 0.2],
    },
    {
        "label": "Afternoon rush, nearly there, 1 stop",
        "features": [15, 14, 1.2, 1, 16, 0, 1, 2.0, 88.0, 8.5, 0.7],
    },
]
print(X.columns)
print(len(X.columns))
for s in scenarios:
    X_input = pd.DataFrame([s["features"]], columns=X.columns)  # ✅ important
    pred = model.predict(X_input)[0]

    print(f"{s['label']}")
    print(f"→ Predicted ETA: {pred:.1f} minutes\n")

from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import numpy as np

mae = mean_absolute_error(y_test, y_pred)

mse = mean_squared_error(y_test, y_pred)
rmse = np.sqrt(mse)

r2 = r2_score(y_test, y_pred)

print("MAE:", mae)
print("RMSE:", rmse)
print("R2 Score:", r2)

model = GradientBoostingRegressor(
    n_estimators=400,      # thoda increase for stability
    max_depth=4,           # slightly reduce for generalization
    learning_rate=0.04,    # slower learning = better
    min_samples_leaf=10,
    subsample=0.7,         # 🔥 data randomness
    max_features=0.7,      # 🔥 feature randomness
    random_state=None      # 🔥 true randomness
)
model.fit(X_train, y_train)
print("Training complete.")
y_pred = model.predict(X_test)
y_pred
mae  = mean_absolute_error(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))
r2   = r2_score(y_test, y_pred)

print(f"\n  Mean Absolute Error (MAE):  {mae:.2f} minutes")
print(f"  Root Mean Squared Error:    {rmse:.2f} minutes")
print(f"  R² Score:                   {r2:.4f}")
print(f"\n  → On average, predictions are off by {mae:.1f} minute(s).")
print(f"  → R² of {r2:.2f} means the model explains {r2*100:.0f}% of ETA variance.")
errors = np.abs(y_pred - y_test.values)
confidence_scores = np.clip(1 - (errors / 10), 0, 1) * 100
print(f"\n  Average confidence score: {confidence_scores.mean():.1f}%")

import random

def random_scenario():
    return [
        random.uniform(10, 50),   # speed_current_kmh
        random.uniform(10, 50),   # speed_avg_5min_kmh
        random.uniform(0.5, 15),  # distance
        random.randint(0, 10),    # stops
        random.randint(0, 23),    # hour
        random.randint(0, 6),     # day
        random.randint(0, 1),     # peak
        random.uniform(0, 10),    # traffic delay
        random.uniform(0, 100),   # progress
        random.uniform(5, 20),    # route length
        random.uniform(0, 1),     # congestion
    ]
for i in range(5):
    features = random_scenario()
    X_input = pd.DataFrame([features], columns=X.columns)
    pred = model.predict(X_input)[0]

    confidence = max(0, (1 - (mae / (pred + 1)))) * 100

    print(f"\n=== Scenario {i+1} ===")

    for col, val in zip(X.columns, features):
        print(f"{col:<25}: {val:.2f}")

    print(f"\n→ Predicted ETA   : {pred:.1f} minutes")
    print(f"→ Confidence      : {confidence:.1f}%")