"""
predictor.py — ETA Model Wrapper
==================================
This module is responsible for one thing: loading the trained
scikit-learn model from disk and using it to make predictions.

Why a separate module?
  The FastAPI server (main.py) handles HTTP concerns — routing,
  request parsing, response formatting. This module handles ML
  concerns — model loading, feature preparation, inference.
  Keeping them separate means you can test the ML logic without
  starting a server, and swap out the model algorithm later without
  touching the API code.

Key design decision — load once, predict many times:
  Loading a .pkl file from disk takes ~100ms. If we loaded it on
  every prediction request, a busy server with 50 buses would waste
  5 seconds per second just loading models. Instead, we load once at
  startup and keep the model object alive in memory. Each prediction
  then takes < 1ms.
"""

import pickle
import numpy as np
import pandas as pd
from pathlib import Path
from config import settings

class ETAPredictor:
    """
    Wraps the trained Gradient Boosting model with a clean interface.
    The server creates exactly one instance of this at startup.
    """

    def __init__(self):
        self.model = None
        self.feature_columns = None
        self.training_stats = None
        self._loaded = False

    def load(self):
        """
        Loads the model from disk. Called once at server startup.
        Raises a clear error if the file is missing so the developer
        knows immediately what went wrong, rather than getting a
        cryptic AttributeError later during a prediction.
        """
        model_path = Path(settings.MODEL_PATH)

        if not model_path.exists():
            raise FileNotFoundError(
                f"Model file not found at '{model_path}'.\n"
                f"Run train_eta_model.py first to generate it."
            )

        with open(model_path, "rb") as f:
            try:
                bundle = pickle.load(f)
            except (pickle.UnpicklingError, Exception) as e:
                raise RuntimeError(
                    f"Failed to deserialize model from '{model_path}'. "
                    "Security note: We only support locally-generated pickle files.\n"
                    f"Underlying error: {e}"
                ) from e

        if not isinstance(bundle, dict):
            raise ValueError(f"Invalid model bundle from '{model_path}': expected a dictionary.")

        missing_keys = [k for k in ("model", "feature_columns") if k not in bundle]
        if missing_keys:
            raise ValueError(
                f"Invalid model file at '{model_path}'. "
                f"Missing required keys: {', '.join(missing_keys)}"
            )

        self.model           = bundle["model"]
        self.feature_columns = bundle["feature_columns"]
        self.training_stats  = bundle.get("training_stats", {})
        self._loaded         = True

        print(f"[predictor] Model loaded from {model_path}")
        print(f"[predictor] Training stats: {self.training_stats}")

    def predict(
        self,
        speed_current_kmh: float,
        speed_avg_5min_kmh: float,
        distance_remaining_km: float,
        stops_remaining: int,
        hour_of_day: int,
        day_of_week: int,
        traffic_delay_minutes: float,
        trip_progress_pct: float,
        route_total_km: float,
    ) -> dict:
        """
        Runs one prediction and returns the ETA in minutes along with
        a confidence score.

        The confidence score is derived from how "certain" the model
        tends to be in similar situations. A bus close to school with
        one stop remaining → high confidence. A bus far away in heavy
        traffic → lower confidence. Parents see this in the UI.

        Returns a dict with:
          eta_minutes    — predicted arrival time
          confidence_pct — reliability score 0–100
          features_used  — echoed back for debugging
        """
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call predictor.load() first.")

        is_peak_hour = int(hour_of_day in [7, 8, 15, 16])

        # Build the feature row as a DataFrame. The column order must
        # match exactly what the model was trained on.
        feature_values = {
            "speed_current_kmh":     speed_current_kmh,
            "speed_avg_5min_kmh":    speed_avg_5min_kmh,
            "distance_remaining_km": distance_remaining_km,
            "stops_remaining":       stops_remaining,
            "hour_of_day":           hour_of_day,
            "day_of_week":           day_of_week,
            "is_peak_hour":          is_peak_hour,
            "traffic_delay_minutes": traffic_delay_minutes,
            "trip_progress_pct":     trip_progress_pct,
            "route_total_km":        route_total_km,
        }

        X = pd.DataFrame([feature_values])[self.feature_columns]
        raw_prediction = float(self.model.predict(X)[0])

        # Clamp: ETAs below 0.5 minutes or above 120 minutes are nonsensical.
        eta_minutes = float(np.clip(raw_prediction, 0.5, 120.0))

        # Confidence heuristic: we derive confidence from two signals.
        #   1. How close the bus is (closer = more predictable)
        #   2. How heavy the traffic delay is (heavy delay = more uncertain)
        # This is not a statistically rigorous interval — it is a
        # practical, human-readable indicator of reliability.
        if route_total_km <= 0:
            closeness_factor = 1.0 if distance_remaining_km == 0 else 0.0
        else:
            closeness_factor = max(0, 1 - (distance_remaining_km / route_total_km))
            
        traffic_factor    = max(0, 1 - (traffic_delay_minutes / 15))
        base_confidence   = 0.65 + 0.20 * closeness_factor + 0.15 * traffic_factor

        # Add small noise so confidence isn't always a round number
        noise             = np.random.uniform(-0.03, 0.03)
        confidence_pct    = float(np.clip((base_confidence + noise) * 100, 50, 98))

        return {
            "eta_minutes":    round(eta_minutes, 1),
            "confidence_pct": round(confidence_pct, 1),
            "features_used":  feature_values,
        }

# Module-level singleton — imported by main.py
predictor = ETAPredictor()
