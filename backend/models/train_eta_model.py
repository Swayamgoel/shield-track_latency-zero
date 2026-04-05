import pandas as pd
import numpy as np
import random
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.ensemble import GradientBoostingRegressor

# Load data
df = pd.read_csv("training_data.csv")

# Features & target
X = df.drop(["eta", "route_total"], axis=1)
y = df["eta"]

print("Columns:", list(X.columns))
print("Total features:", len(X.columns))

# Train test split
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# Model
model = GradientBoostingRegressor(
    n_estimators=400,
    max_depth=4,
    learning_rate=0.04,
    min_samples_leaf=10,
    subsample=0.7,
    max_features=0.7,
    random_state=42
)

model.fit(X_train, y_train)
print("Training complete.")

# Predictions
y_pred = model.predict(X_test)

# Metrics
mae = mean_absolute_error(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))
r2 = r2_score(y_test, y_pred)

print(f"\nMAE:  {mae:.2f}")
print(f"RMSE: {rmse:.2f}")
print(f"R2:   {r2:.4f}")

# Feature importance
importances = pd.Series(model.feature_importances_, index=X.columns)
importances = importances.sort_values(ascending=False)

print("\nFeature Importances:")
for feat, imp in importances.items():
    print(f"{feat:<25}: {imp:.3f}")

# -------------------------------
# ✅ FIXED SCENARIOS (MATCH LENGTH)
# -------------------------------

def generate_scenario():
    return [random.uniform(0, 50) for _ in range(len(X.columns))]

for i in range(5):
    features = generate_scenario()

    X_input = pd.DataFrame([features], columns=X.columns)
    pred = model.predict(X_input)[0]

    confidence = max(0, (1 - (mae / (pred + 1)))) * 100

    print(f"\n=== Scenario {i+1} ===")
    for col, val in zip(X.columns, features):
        print(f"{col:<25}: {val:.2f}")

    print(f"\n→ Predicted ETA : {pred:.1f} minutes")
    print(f"→ Confidence    : {confidence:.1f}%")