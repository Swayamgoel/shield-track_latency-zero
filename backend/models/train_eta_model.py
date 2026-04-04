"""
ShieldTrack — ETA Model Trainer
================================
This script loads the synthetic training data, trains a Gradient Boosting
model, evaluates its accuracy, and saves the trained model to a file.

The saved .pkl file is what your FastAPI server loads at startup to
serve live predictions without re-training every time.

Why Gradient Boosting?
- It handles non-linear patterns naturally (e.g. rush hour isn't linear)
- It's robust to noisy features (which GPS data always has)
- It gives good results with relatively small datasets (16k rows is fine)
- It's fast enough to train on a laptop in under 30 seconds
"""

import pandas as pd
import numpy as np
import pickle
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import StandardScaler

# ─── Load Training Data ─────────────────────────────────────────────────────
print("Loading training data...")
df = pd.read_csv("training_data.csv")

# These are the exact features the model will see at prediction time.
# IMPORTANT: this list must match exactly what your FastAPI endpoint sends.
FEATURE_COLUMNS = [
    "speed_current_kmh",
    "speed_avg_5min_kmh",
    "distance_remaining_km",
    "stops_remaining",
    "hour_of_day",
    "day_of_week",
    "is_peak_hour",
    "traffic_delay_minutes",
    "trip_progress_pct",
    "route_total_km",
]

LABEL_COLUMN = "actual_eta_minutes"

X = df[FEATURE_COLUMNS]
y = df[LABEL_COLUMN]

# ─── Train / Test Split ─────────────────────────────────────────────────────
# We keep 20% of the data aside to evaluate on rows the model never saw.
# This is how we get an honest estimate of real-world accuracy.
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

print(f"Training set: {len(X_train):,} rows")
print(f"Test set:     {len(X_test):,} rows")

# ─── Train the Model ─────────────────────────────────────────────────────────
print("\nTraining Gradient Boosting model...")

model = GradientBoostingRegressor(
    n_estimators=300,      # number of trees — more = more accurate but slower
    max_depth=5,           # how deep each tree goes — 5 is a good default
    learning_rate=0.05,    # smaller = slower learning but more stable
    min_samples_leaf=10,   # prevents overfitting on tiny subgroups
    random_state=42,
)

model.fit(X_train, y_train)
print("Training complete.")

# ─── Evaluate ───────────────────────────────────────────────────────────────
print("\nEvaluating on held-out test set...")

y_pred = model.predict(X_test)

mae  = mean_absolute_error(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))
r2   = r2_score(y_test, y_pred)

print(f"\n  Mean Absolute Error (MAE):  {mae:.2f} minutes")
print(f"  Root Mean Squared Error:    {rmse:.2f} minutes")
print(f"  R² Score:                   {r2:.4f}")
print(f"\n  → On average, predictions are off by {mae:.1f} minute(s).")
print(f"  → R² of {r2:.2f} means the model explains {r2*100:.0f}% of ETA variance.")

# ─── Confidence Score ────────────────────────────────────────────────────────
# A confidence score tells parents how certain the prediction is.
# We compute it from the residuals: predictions close to truth = high confidence.
# Confidence = 100% when error is 0, drops to 0% when error exceeds 10 minutes.
errors = np.abs(y_pred - y_test.values)
confidence_scores = np.clip(1 - (errors / 10), 0, 1) * 100
print(f"\n  Average confidence score: {confidence_scores.mean():.1f}%")

# ─── Feature Importance ─────────────────────────────────────────────────────
# This tells us which features the model relied on most.
# Useful for understanding and for explaining to judges.
importances = pd.Series(model.feature_importances_, index=FEATURE_COLUMNS)
importances = importances.sort_values(ascending=False)

print("\nFeature importances (which inputs matter most):")
for feat, imp in importances.items():
    bar = "█" * int(imp * 40)
    print(f"  {feat:<30} {imp:.3f}  {bar}")

# ─── Quick Sanity Check ──────────────────────────────────────────────────────
# Let's manually predict a couple of scenarios to make sure outputs feel right.
print("\n── Sanity checks ──────────────────────────────────────────────────────")

scenarios = [
    {
        "label": "Peak hour, 3 km left, 2 stops",
        "features": [18, 17, 3.0, 2, 8, 1, 1, 3.5, 70.0, 8.5],
    },
    {
        "label": "Off-peak, 8 km left, 5 stops",
        "features": [32, 30, 8.0, 5, 11, 2, 0, 0.5, 20.0, 12.0],
    },
    {
        "label": "Afternoon rush, nearly there, 1 stop",
        "features": [15, 14, 1.2, 1, 16, 0, 1, 2.0, 88.0, 8.5],
    },
]

for s in scenarios:
    X_input = pd.DataFrame([s["features"]], columns=FEATURE_COLUMNS)
    pred = model.predict(X_input)[0]
    print(f"  {s['label']}")
    print(f"    → Predicted ETA: {pred:.1f} minutes\n")

# ─── Save Model ──────────────────────────────────────────────────────────────
print("Saving trained model...")
with open("eta_model.pkl", "wb") as f:
    pickle.dump({
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "training_stats": {
            "mae_minutes": round(mae, 2),
            "r2_score": round(r2, 4),
            "avg_confidence_pct": round(float(confidence_scores.mean()), 1),
            "trained_on_rows": len(X_train),
        }
    }, f)

print("Model saved to eta_model.pkl")
