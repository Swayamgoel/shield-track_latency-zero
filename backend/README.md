# ShieldTrack ML Backend

**Team Latency Zero · Eclipse 6.0 · Open Innovation Track · EC603**

A Python-based machine learning backend that transforms ShieldTrack from a real-time tracking system into an intelligent, predictive fleet management platform. It provides two core capabilities: predicting bus arrival times with a confidence score, and recommending optimal routes using a graph-based optimizer with learned congestion costs.

---

## Table of Contents

1. [Why this exists](#1-why-this-exists)
2. [How it fits into the full system](#2-how-it-fits-into-the-full-system)
3. [Project structure](#3-project-structure)
4. [Prerequisites](#4-prerequisites)
5. [Setup from scratch](#5-setup-from-scratch)
6. [Supabase configuration](#6-supabase-configuration)
7. [Environment variables](#7-environment-variables)
8. [Generating training data](#8-generating-training-data)
9. [Training the ETA model](#9-training-the-eta-model)
10. [Starting the server](#10-starting-the-server)
11. [API reference](#11-api-reference)
12. [How the ETA model works](#12-how-the-eta-model-works)
13. [How the route optimizer works](#13-how-the-route-optimizer-works)
14. [Integrating with your apps](#14-integrating-with-your-apps)
15. [ML vs Google Maps: cost comparison](#15-ml-vs-google-maps-cost-comparison)
16. [Troubleshooting](#16-troubleshooting)
17. [File-by-file reference](#17-file-by-file-reference)

---

## 1. Why this exists

The base ShieldTrack system uses a deterministic formula for ETA:

```
eta = distance_remaining / rolling_avg_speed
```

This works but has two problems. First, it ignores everything the system already knows — that 8 AM on a Tuesday is slower than 11 AM, that a route with 6 stops remaining takes longer than the raw distance implies, or that the current traffic delay from Google Maps suggests the road ahead is congested. Second, it produces no confidence score, so parents have no way of knowing whether the "12 minutes" shown is a solid estimate or a rough guess.

This ML backend solves both problems. It replaces the formula with a Gradient Boosting Regressor trained on thousands of simulated bus trips, and augments the route selection with a graph-based optimizer (Dijkstra's algorithm) whose edge weights are influenced by learned congestion patterns. The result is predictions that improve with data and route recommendations that adapt to time of day.

---

## 2. How it fits into the full system

```
┌─────────────────┐     GPS every 7s      ┌──────────────────────┐
│   Driver App    │ ───────────────────▶  │                      │
│ (Expo Mobile)   │                       │      Supabase        │
└─────────────────┘                       │  (Postgres + RT)     │
                                          │                      │
┌─────────────────┐     reads/writes      │  bus_locations       │
│   Admin Portal  │ ◀──────────────────▶  │  bus_eta_predictions │
│  (Vite + React) │                       │  bus_route_recs      │
└─────────────────┘                       │  deviation_alerts    │
                                          │  sos_events          │
┌─────────────────┐     reads only        │                      │
│   Parent App    │ ◀─────────────────── │                      │
│ (Expo Mobile)   │                       └──────────┬───────────┘
└─────────────────┘                                  │ writes predictions
                                                     │
                                          ┌──────────▼───────────┐
                                          │  ML Backend (Python) │
                                          │  FastAPI + uvicorn   │
                                          │  localhost:8000      │
                                          └──────────────────────┘
```

**Key design principle:** Your mobile apps never call the ML server directly. They only ever talk to Supabase, which they already know how to do. The ML server is an invisible brain that reads GPS data from Supabase and writes predictions back. Apps pick up predictions via their existing Realtime subscriptions — zero changes needed in the app code.

**Data flow step by step:**

1. Driver app inserts a GPS row into `bus_locations` every 7 seconds
2. Your simulation script (or a Supabase webhook) calls `POST /predict/eta` with the current bus state
3. The ML server runs inference — the trained model computes ETA and confidence
4. The server writes the prediction to `bus_eta_predictions` in Supabase
5. Supabase Realtime broadcasts the new row to all subscribed clients
6. Parent app and Admin portal display the updated ETA automatically

---

## 3. Project structure

```
shieldtrack_ml/
│
├── .env.example              # Template — copy to .env and fill in secrets
├── .env                      # Your real secrets — NEVER commit this to git
├── requirements.txt          # Python package dependencies
│
├── config.py                 # Reads .env, shares settings app-wide
├── predictor.py              # ML model wrapper — loads model, runs ETA inference
├── router.py                 # Graph route optimizer (Dijkstra + ML cost function)
├── supabase_writer.py        # Writes predictions back to Supabase
├── main.py                   # FastAPI server — ties everything together
│
├── generate_synthetic_data.py  # Run ONCE to create training_data.csv
├── train_eta_model.py          # Run ONCE to train and save eta_model.pkl
│
└── eta_model.pkl               # Trained model (generated, not hand-written)
```

`eta_model.pkl` does not exist when you first clone or download this project. It is produced by running the two setup scripts described in sections 8 and 9.

---

## 4. Prerequisites

| Requirement                   | Version         | Check              |
| ----------------------------- | --------------- | ------------------ |
| Python                        | 3.10 or higher  | `python --version` |
| pip                           | Any recent      | `pip --version`    |
| A Supabase project            | Already created | —                  |
| Node.js (for your other apps) | 18+             | `node --version`   |

You do **not** need a Google Maps API key to run this server. Setting `GOOGLE_MAPS_API_KEY=mock` in your `.env` makes the server simulate realistic traffic delays, which is perfectly sufficient for the hackathon demo.

---

## 5. Setup from scratch

Run these commands exactly once, in order. After this, you only need the last command (`uvicorn`) each time you want to start the server.

**Step 1 — Navigate to the backend folder.**

Your terminal must be in the same folder as `main.py` for every command below. This is the most common source of errors.

```bash
cd path/to/shieldtrack_ml
```

Verify you are in the right place:

```bash
# Windows
dir

# macOS / Linux
ls
```

You should see `main.py`, `predictor.py`, `requirements.txt`, and the other files listed in section 3. If you do not see them, you are in the wrong folder.

**Step 2 — Create a virtual environment (recommended).**

A virtual environment keeps the Python packages for this project isolated from everything else on your system. This prevents version conflicts.

```bash
# Create the environment
python -m venv .venv

# Activate it — Windows
.venv\Scripts\activate

# Activate it — macOS / Linux
source .venv/bin/activate
```

Your terminal prompt will change to show `(.venv)` when the environment is active. Always activate it before running any of the commands below.

**Step 3 — Install Python dependencies.**

```bash
pip install -r requirements.txt
```

This installs FastAPI, scikit-learn, pandas, numpy, httpx, and uvicorn. It takes 1–2 minutes and you only do it once.

**Step 4 — Create your `.env` file.**

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `.env` in any text editor and fill in your Supabase URL and service role key (see section 7 for where to find these).

**Step 5 — Generate synthetic training data.**

```bash
python generate_synthetic_data.py
```

Expected output:

```
Generating 2000 synthetic trips...
  500/2000 trips done...
  1000/2000 trips done...
  1500/2000 trips done...
  2000/2000 trips done...

Done! Generated 16,000 training rows from 2000 trips.
ETA range: 0.5 – 67.6 minutes
Average ETA: 17.7 minutes

Saved to training_data.csv
```

This creates `training_data.csv` in about 2 seconds.

**Step 6 — Train the model.**

```bash
python train_eta_model.py
```

Expected output:

```
Loading training data...
Training set: 12,800 rows
Test set:     3,200 rows

Training Gradient Boosting model...
Training complete.

  Mean Absolute Error (MAE):  1.42 minutes
  Root Mean Squared Error:    1.79 minutes
  R² Score:                   0.9783

  → On average, predictions are off by 1.4 minute(s).
  → R² of 0.98 means the model explains 98% of ETA variance.

  Average confidence score: 85.8%

Feature importances:
  distance_remaining_km     0.822  ████████████████████████████████
  stops_remaining           0.099  ███
  traffic_delay_minutes     0.070  ██
  ...

Model saved to eta_model.pkl
```

This creates `eta_model.pkl` — the trained model file the server loads at startup. You never need to re-run steps 5 and 6 unless you want to retrain with different parameters.

**Step 7 — Start the server.**

```bash
uvicorn main:app --reload --port 8000
```

Expected output:

```
[startup] Loading ML model...
[predictor] Model loaded from eta_model.pkl
[predictor] Training stats: {'mae_minutes': 1.42, 'r2_score': 0.9783, ...}
[startup] ShieldTrack ML server is ready.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

The server is now live. Open `http://localhost:8000/docs` in a browser to see the interactive API documentation where you can test every endpoint.

---

## 6. Supabase configuration

The ML backend writes its predictions into two new tables that do not exist in the base ShieldTrack schema. You need to create them before the server can persist predictions.

Open your Supabase project → **SQL Editor** → **New query**, and run the following SQL blocks one at a time.

**Create the ETA predictions table:**

```sql
CREATE TABLE IF NOT EXISTS bus_eta_predictions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id         TEXT NOT NULL REFERENCES buses(id),
  eta_minutes    NUMERIC NOT NULL,
  confidence_pct NUMERIC NOT NULL,
  predicted_at   TIMESTAMPTZ DEFAULT now(),
  features_json  JSONB
);

CREATE INDEX IF NOT EXISTS idx_eta_bus_id
  ON bus_eta_predictions(bus_id);

CREATE INDEX IF NOT EXISTS idx_eta_predicted_at
  ON bus_eta_predictions(predicted_at DESC);
```

**Create the route recommendations table:**

```sql
CREATE TABLE IF NOT EXISTS bus_route_recommendations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id         TEXT NOT NULL REFERENCES buses(id),
  recommended_at TIMESTAMPTZ DEFAULT now(),
  routes_json    JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_route_bus_id
  ON bus_route_recommendations(bus_id);
```

**Add Row Level Security policies** so your apps can read the predictions:

```sql
-- Allow authenticated users (parents, admins) to read ETA predictions
ALTER TABLE bus_eta_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ETA predictions"
  ON bus_eta_predictions
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to read route recommendations
ALTER TABLE bus_route_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read route recommendations"
  ON bus_route_recommendations
  FOR SELECT
  TO authenticated
  USING (true);
```

The ML server uses the `service_role` key which bypasses RLS entirely, so no insert policy is needed for the server — only the read policies for the apps.

**Enable Realtime on both tables** so predictions appear in the apps automatically:

Go to **Database → Replication** (or **Database → Realtime** depending on your Supabase version). Find `bus_eta_predictions` and `bus_route_recommendations` in the table list and toggle them on.

---

## 7. Environment variables

Open `.env` and fill in the following values.

| Variable               | Description                   | Where to find it                                         |
| ---------------------- | ----------------------------- | -------------------------------------------------------- |
| `SUPABASE_URL`         | Your project URL              | Supabase Dashboard → Settings → API → Project URL        |
| `SUPABASE_SERVICE_KEY` | Service role key              | Supabase Dashboard → Settings → API → `service_role` key |
| `GOOGLE_MAPS_API_KEY`  | Maps API key for live traffic | Google Cloud Console — set to `mock` to skip             |
| `MODEL_PATH`           | Path to trained model file    | Leave as `eta_model.pkl`                                 |
| `DEBUG`                | Print verbose logs            | Set `true` during development                            |

**Critical:** Use the `service_role` key, not the `anon` key. The service role key lets the backend write predictions to Supabase without being blocked by Row Level Security. Never put the service role key in your mobile app — it belongs only in this `.env` file on the server.

Full `.env` example:

```env
SUPABASE_URL=https://abcdefghij.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
GOOGLE_MAPS_API_KEY=mock
MODEL_PATH=eta_model.pkl
DEBUG=true
```

---

## 8. Generating training data

**File:** `generate_synthetic_data.py`
**Run:** Once, before training
**Output:** `training_data.csv`

Since no real labeled dataset of school bus trips exists, this script generates realistic synthetic trips. The key insight is that the model does not need _real_ data — it needs _realistic_ data. As long as the simulated trips exhibit the same patterns as real buses (morning rush is slower, stop dwell time adds up, weekday traffic differs from weekend), the model will learn those patterns just as effectively.

### What one training example looks like

Each row in the CSV represents a single moment mid-trip — a snapshot of what the system can observe right now, paired with the ground truth of how many minutes the bus actually took to arrive.

| Column                  | Type  | Description                                 |
| ----------------------- | ----- | ------------------------------------------- |
| `speed_current_kmh`     | float | Bus speed at this exact moment              |
| `speed_avg_5min_kmh`    | float | Rolling average speed over last 5 minutes   |
| `distance_remaining_km` | float | Straight-line distance left to destination  |
| `stops_remaining`       | int   | Number of stops still ahead                 |
| `hour_of_day`           | int   | 0–23, what hour the snapshot was taken      |
| `day_of_week`           | int   | 0=Monday, 6=Sunday                          |
| `is_peak_hour`          | int   | 1 if hour is 7, 8, 15, or 16 — else 0       |
| `traffic_delay_minutes` | float | Extra delay from Google Maps (or simulated) |
| `trip_progress_pct`     | float | How far through the trip, 0–100             |
| `route_total_km`        | float | Total length of this route                  |
| `actual_eta_minutes`    | float | **Label** — ground truth remaining minutes  |

### How realism is achieved

The generator models three layers of variation:

**Base physics.** A bus at speed `v` covering distance `d` takes time `d/v`. This gives the structural skeleton of a trip.

**Contextual multipliers.** A per-hour congestion factor slows the bus at rush hour. The table below shows the multipliers used:

| Hours      | Congestion factor | Meaning              |
| ---------- | ----------------- | -------------------- |
| 7–8 AM     | 1.7–1.8×          | Morning school rush  |
| 3–4 PM     | 1.6–1.9×          | Afternoon dismissal  |
| 10 AM–2 PM | 1.0–1.1×          | Light midday traffic |
| Late night | 1.0×              | Free-flow            |

**Random noise.** Even identical conditions vary day to day. Each trip adds ±10% random variation on top of the congestion factor, and each speed reading adds Gaussian noise. This teaches the model to express uncertainty via the confidence score rather than false precision.

### Customising for your routes

The script currently generates trips across five fictional routes. Before the hackathon, replace the `ROUTES` list with your actual route data:

```python
ROUTES = [
    {"route_id": "R1", "total_distance_km": 8.5,  "num_stops": 6},
    {"route_id": "R2", "total_distance_km": 12.0, "num_stops": 9},
    # Add your real routes here
]
```

Changing the congestion multipliers in `HOURLY_CONGESTION` to reflect your local city's traffic pattern will also improve real-world accuracy.

---

## 9. Training the ETA model

**File:** `train_eta_model.py`
**Run:** Once, after generating data
**Output:** `eta_model.pkl`

### Algorithm: Gradient Boosting Regressor

The model is a `GradientBoostingRegressor` from scikit-learn. This algorithm builds an ensemble of decision trees sequentially — each new tree corrects the errors of the previous ones. It was chosen because it handles non-linear patterns naturally (rush-hour slowdowns are not linear), is robust to noisy GPS inputs, produces excellent accuracy on medium-sized tabular datasets, and trains in under 30 seconds on a laptop.

### Model parameters

```python
GradientBoostingRegressor(
    n_estimators=300,    # 300 trees in the ensemble
    max_depth=5,         # each tree explores up to 5 decision levels
    learning_rate=0.05,  # each tree contributes 5% to the final answer
    min_samples_leaf=10, # prevents overfitting on tiny data subsets
)
```

### Training and evaluation split

The script randomly holds out 20% of the data (3,200 rows) for evaluation. The model never sees these rows during training, so the accuracy numbers are an honest estimate of real-world performance.

### Accuracy results on 16,000 rows

| Metric                  | Value    | Interpretation                                |
| ----------------------- | -------- | --------------------------------------------- |
| Mean Absolute Error     | 1.42 min | Average prediction is off by 1.4 minutes      |
| Root Mean Squared Error | 1.79 min | Larger errors are penalised more              |
| R² Score                | 0.978    | Model explains 97.8% of ETA variation         |
| Avg. confidence score   | 85.8%    | Typical prediction reliability shown to users |

### Feature importances

The model tells us which inputs mattered most for accurate predictions:

| Feature                 | Importance | Why                                                       |
| ----------------------- | ---------- | --------------------------------------------------------- |
| `distance_remaining_km` | 82%        | How far the bus still has to go is the dominant predictor |
| `stops_remaining`       | 10%        | Each stop adds 30–90 seconds of unpredictable dwell time  |
| `traffic_delay_minutes` | 7%         | The Google Maps signal encodes rush-hour conditions       |
| Speed, hour, day        | <5%        | Already captured implicitly by the traffic delay signal   |

### What gets saved in `eta_model.pkl`

The file is a Python pickle containing a dictionary:

```python
{
    "model":            <fitted GradientBoostingRegressor>,
    "feature_columns":  ["speed_current_kmh", "distance_remaining_km", ...],
    "training_stats":   {"mae_minutes": 1.42, "r2_score": 0.9783, ...}
}
```

The server loads this dictionary at startup and keeps it in memory. Each prediction call takes under 1 millisecond.

---

## 10. Starting the server

Always run this from inside the `shieldtrack_ml` folder with the virtual environment active:

```bash
# Make sure you are in the right folder first
cd path/to/shieldtrack_ml

# Windows — activate venv
.venv\Scripts\activate

# macOS / Linux — activate venv
source .venv/bin/activate

# Start the server
uvicorn main:app --reload --port 8000
```

The `--reload` flag restarts the server automatically whenever you edit a Python file. Use it during development. Remove it in production.

**Verify the server is running** by opening `http://localhost:8000` in a browser. You should see:

```json
{
  "status": "ok",
  "service": "ShieldTrack ML Backend",
  "model_loaded": true
}
```

**Interactive docs** are available at `http://localhost:8000/docs` — a full Swagger UI where you can test every endpoint by clicking "Try it out".

---

## 11. API reference

Base URL: `http://localhost:8000`

All endpoints accept and return JSON. No authentication is required (the server is only accessible from your local network during the hackathon).

---

### `GET /`

Health check. Returns server status and whether the model is loaded.

**Response:**

```json
{
  "status": "ok",
  "service": "ShieldTrack ML Backend",
  "timestamp": "2025-04-01T08:00:00",
  "model_loaded": true
}
```

---

### `GET /model-info`

Returns statistics about the loaded ML model.

**Response:**

```json
{
  "feature_columns": ["speed_current_kmh", "distance_remaining_km", "..."],
  "training_stats": {
    "mae_minutes": 1.42,
    "r2_score": 0.9783,
    "avg_confidence_pct": 85.8,
    "trained_on_rows": 12800
  }
}
```

---

### `POST /predict/eta`

Predicts how many minutes until a bus reaches its destination.

**Request body:**

```json
{
  "bus_id": "550e8400-e29b-41d4-a716-446655440000",
  "speed_current_kmh": 22.5,
  "speed_avg_5min_kmh": 20.0,
  "distance_remaining_km": 5.2,
  "stops_remaining": 3,
  "hour_of_day": 8,
  "day_of_week": 1,
  "route_total_km": 12.0,
  "trip_progress_pct": 56.7,

  "traffic_delay_minutes": 3.5,
  "origin_lat": 31.108,
  "origin_lng": 76.098,
  "dest_lat": 31.125,
  "dest_lng": 76.116
}
```

The last four fields are optional. If you omit `traffic_delay_minutes`, the server infers it from the hour of day. If you include coordinates, the server can fetch live traffic from Google Maps (only relevant when `GOOGLE_MAPS_API_KEY` is set to a real key).

**Response:**

```json
{
  "bus_id":           "550e8400-e29b-41d4-a716-446655440000",
  "eta_minutes":      16.5,
  "confidence_pct":   86.0,
  "predicted_at":     "2025-04-01T08:14:22",
  "supabase_written": true,
  "debug_features":   { ... }
}
```

`confidence_pct` is a 0–100 score indicating how reliable the prediction is. Higher values mean the bus is closer to its destination with predictable conditions ahead. This is displayed alongside the ETA in the Parent app.

`supabase_written` tells you whether the prediction was successfully saved to the database. If `false`, check your Supabase credentials in `.env`.

---

### `POST /predict/route`

Returns 2–3 ranked route options from the bus's current position to the school.

**Request body:**

```json
{
  "bus_id": "550e8400-e29b-41d4-a716-446655440000",
  "origin_lat": 31.108,
  "origin_lng": 76.098,
  "dest_lat": 31.125,
  "dest_lng": 76.116,
  "hour_of_day": 8,
  "num_stops": 4
}
```

**Response:**

```json
{
  "bus_id": "550e8400-e29b-41d4-a716-446655440000",
  "routes": [
    {
      "route_id": "RT-A",
      "waypoints": ["Bus Depot", "Main Chowk", "NH-44 Turn", "City School"],
      "distance_km": 3.97,
      "estimated_minutes": 15.3,
      "congestion_level": "high",
      "is_recommended": true,
      "notes": "Fastest based on current traffic"
    },
    {
      "route_id": "RT-B",
      "waypoints": ["Via Main Road", "Main Chowk", "NH-44 Turn", "City School"],
      "distance_km": 4.37,
      "estimated_minutes": 14.6,
      "congestion_level": "medium",
      "is_recommended": false,
      "notes": "Avoids school-zone congestion"
    },
    {
      "route_id": "RT-C",
      "waypoints": ["Via Bypass Road", "..."],
      "distance_km": 4.97,
      "estimated_minutes": 17.8,
      "congestion_level": "low",
      "is_recommended": false,
      "notes": "Longer but avoids all peak-hour zones"
    }
  ],
  "recommended_at": "2025-04-01T08:14:22",
  "supabase_written": true
}
```

The first route in the array is always the recommended one (`is_recommended: true`). Routes are sorted by estimated travel time with the recommended route first.

---

### `POST /predict/batch-eta`

Predicts ETAs for multiple buses in a single request. Ideal for your simulation script.

**Request body:** An array of bus update objects (same fields as `/predict/eta` minus the optional ones).

```json
[
  {
    "bus_id": "550e8400-e29b-41d4-a716-446655440000",
    "speed_current_kmh": 18,
    "speed_avg_5min_kmh": 17,
    "distance_remaining_km": 4.2,
    "stops_remaining": 3,
    "hour_of_day": 8,
    "day_of_week": 1,
    "route_total_km": 12,
    "trip_progress_pct": 65
  },
  {
    "bus_id": "660e8400-e29b-41d4-a716-446655440001",
    "speed_current_kmh": 28,
    "speed_avg_5min_kmh": 26,
    "distance_remaining_km": 9.1,
    "stops_remaining": 6,
    "hour_of_day": 8,
    "day_of_week": 1,
    "route_total_km": 15,
    "trip_progress_pct": 39
  }
]
```

**Response:**

```json
{
  "predictions": [
    {
      "bus_id": "550e8400-e29b-41d4-a716-446655440000",
      "eta_minutes": 16.5,
      "confidence_pct": 89.4
    },
    {
      "bus_id": "660e8400-e29b-41d4-a716-446655440001",
      "eta_minutes": 28.0,
      "confidence_pct": 84.7
    }
  ],
  "count": 2
}
```

---

## 12. How the ETA model works

Understanding this section will help you explain the ML system to judges.

### The problem framed as supervised learning

ETA prediction is a **regression problem**: given a set of observable features (what we can measure right now), predict a continuous output (minutes until arrival). We frame it as supervised learning because we can generate labeled examples — pairs of (features, true ETA) — from our simulated trips.

### Why Gradient Boosting

Gradient Boosting builds its final prediction by combining hundreds of simple decision trees, where each tree focuses on correcting the errors made by all previous trees. This gives it several important properties for our use case:

- It naturally captures non-linear interactions. The relationship between `hour_of_day` and `eta_minutes` is not a straight line — 8 AM is disproportionately slow, not just slightly slower than 7 AM. Gradient Boosting discovers this automatically.
- It is robust to noisy features. GPS speed readings fluctuate. The model learns to average over noise rather than overfitting to individual outliers.
- It produces a reliable feature importance ranking, which you can show judges to explain what the model learned.

### The confidence score

The confidence score is not a direct model output — the regression model only outputs a single number (predicted minutes). The confidence is derived from a heuristic based on two signals: how close the bus is to its destination (close = more predictable) and how heavy the current traffic delay is (heavy delay = more uncertain). The formula is:

```
base_confidence = 0.65 + 0.20 × closeness_factor + 0.15 × (1 - traffic_factor)
confidence_pct  = clip(base_confidence × 100, 50, 98)
```

This means confidence ranges from 50% (far away, heavy traffic) to 98% (almost there, clear roads). It is shown to parents in the app so they understand whether to take the ETA literally or treat it as approximate.

### Why the model beats the formula

The base formula `eta = distance / speed` works but misses things the model captures:

| Factor                | Formula      | ML model                                            |
| --------------------- | ------------ | --------------------------------------------------- |
| Stop dwell time       | Ignored      | Learned as `stops_remaining` feature                |
| Rush-hour patterns    | Ignored      | Learned via `hour_of_day` + `traffic_delay_minutes` |
| Day-of-week variation | Ignored      | Learned via `day_of_week` feature                   |
| Non-linear congestion | Cannot model | Captured by tree structure                          |
| Confidence estimate   | Not possible | Derived from prediction context                     |

---

## 13. How the route optimizer works

### Representing roads as a graph

A road network is a mathematical **graph**: intersections are nodes (vertices), and road segments connecting them are edges. Each edge has a **weight** representing the cost of travelling along it — in our case, estimated travel time in minutes.

Finding the fastest route reduces to the classical computer science problem: **shortest path in a weighted graph**. Dijkstra's algorithm solves this optimally in O((V + E) log V) time, where V is the number of intersections and E is the number of road segments.

### Dijkstra's algorithm — intuition

Imagine you're standing at the origin and you have a priority queue of all intersections ordered by "cheapest cost to reach from origin". You always expand the cheapest unvisited intersection first. When you finally pop the destination off the queue, you've found the globally optimal path — because any alternative path would have been expanded first if it were cheaper.

```
heap = [(cost=0, node=origin, path=[origin])]

while heap is not empty:
    cost, node, path = pop cheapest from heap

    if node == destination:
        return path  ← optimal route found

    for each neighbour of node:
        edge_cost = haversine_distance × road_factor / effective_speed
        push (cost + edge_cost, neighbour, path + [neighbour]) to heap
```

### The ML enhancement: learned edge weights

The standard version of Dijkstra uses static edge weights (fixed speed limits). Our enhancement replaces static speeds with a **learned congestion function**:

```
effective_speed = FREE_FLOW_SPEED / congestion_factor(hour, road_type)
edge_time = edge_distance / effective_speed
```

The congestion factors were learned from the same training data used for the ETA model — so the router knows that roads near schools are slower at 8 AM, that bypass roads flow freely at peak hour, and so on. This is the same principle behind Google Maps "avoids congested areas" — they have more data, but the mechanism is identical.

### Why multiple route options

The server returns 2–3 routes, not just one. This is useful for two reasons:

1. The "fastest" route by pure time might go through an area the school administrators know to avoid (construction, school zone, etc.). Alternatives give the admin portal something to show.
2. During the demo, showing multiple ranked options with different congestion levels (high / medium / low) is a much more compelling demonstration of intelligence than a single answer.

---

## 14. Integrating with your apps

### Calling from simulate-bus.js

In your existing GPS simulation script, add a fetch call after each GPS insert:

```javascript
const ML_SERVER = "http://localhost:8000";

async function callMLServer(busState) {
  try {
    const response = await fetch(`${ML_SERVER}/predict/eta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bus_id: busState.busId,
        speed_current_kmh: busState.speed,
        speed_avg_5min_kmh: busState.avgSpeed,
        distance_remaining_km: busState.distanceLeft,
        stops_remaining: busState.stopsLeft,
        hour_of_day: new Date().getHours(),
        day_of_week: new Date().getDay(),
        route_total_km: busState.routeTotalKm,
        trip_progress_pct:
          (busState.distanceCovered / busState.routeTotalKm) * 100,
      }),
    });
    const prediction = await response.json();
    console.log(
      `[${busState.busId}] ETA: ${prediction.eta_minutes} min (${prediction.confidence_pct}% confidence)`,
    );
  } catch (err) {
    // ML server might not be running — don't crash the simulation
    console.warn(`[ML] Prediction failed: ${err.message}`);
  }
}
```

For multiple buses, use the batch endpoint instead to reduce the number of HTTP calls:

```javascript
async function callMLServerBatch(allBuses) {
  const response = await fetch(`${ML_SERVER}/predict/batch-eta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      allBuses.map((b) => ({
        bus_id: b.busId,
        speed_current_kmh: b.speed,
        speed_avg_5min_kmh: b.avgSpeed,
        distance_remaining_km: b.distanceLeft,
        stops_remaining: b.stopsLeft,
        hour_of_day: new Date().getHours(),
        day_of_week: new Date().getDay(),
        route_total_km: b.routeTotalKm,
        trip_progress_pct: (b.distanceCovered / b.routeTotalKm) * 100,
      })),
    ),
  });
  return response.json();
}
```

### Reading predictions in the Parent app (React Native)

Subscribe to the `bus_eta_predictions` table in Supabase Realtime — predictions will appear here automatically after the ML server writes them.

```typescript
// hooks/useETAPrediction.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useETAPrediction(busId: string) {
  const [eta, setEta] = useState<{
    minutes: number;
    confidence: number;
  } | null>(null);

  useEffect(() => {
    // Fetch the latest prediction immediately
    supabase
      .from("bus_eta_predictions")
      .select("eta_minutes, confidence_pct")
      .eq("bus_id", busId)
      .order("predicted_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data)
          setEta({
            minutes: data.eta_minutes,
            confidence: data.confidence_pct,
          });
      });

    // Subscribe to new predictions via Realtime
    const channel = supabase
      .channel(`eta-${busId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bus_eta_predictions",
          filter: `bus_id=eq.${busId}`,
        },
        (payload) => {
          setEta({
            minutes: payload.new.eta_minutes,
            confidence: payload.new.confidence_pct,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [busId]);

  return eta;
}
```

Usage in a screen component:

```typescript
const eta = useETAPrediction(busId);

// In your JSX:
{eta ? (
  <>
    <Text>Arriving in {Math.round(eta.minutes)} minutes</Text>
    <Text>{eta.confidence}% confidence</Text>
  </>
) : (
  <Text>Calculating ETA...</Text>
)}
```

---

## 15. ML vs Google Maps: cost comparison

This is the core competitive argument for the ML approach.

### Why Google Maps gets expensive

Every call to the Google Maps Routes API or Directions API costs money. At the GPS update rate ShieldTrack uses (7 seconds), the number of API calls grows very quickly:

```
calls/month = buses × (3600 / interval_seconds) × hours_per_day × 22 days
```

For a school with 20 buses, 4 active hours per day, 7-second updates:

```
20 × 514 × 4 × 22 = 904,320 calls/month
At $0.007/call  = $6,330/month
```

### The ShieldTrack ML approach

| Component                       | Cost                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| ETA predictions                 | ~$0 — runs on your own Python process                            |
| Route optimization              | ~$0 — uses the OSM road graph locally                            |
| Map tile display                | ~$2–5/month — tiles are cached, not called per update            |
| Google Maps traffic signal      | ~$0.50/month — called once per bus per trip, not every 7 seconds |
| Server hosting (post-hackathon) | ~$10–20/month on a basic VPS                                     |
| **Total**                       | **~$15–25/month**                                                |

### What you lose vs Google Maps

Google Maps has more data. Its congestion model is trained on hundreds of millions of real trips, not 16,000 synthetic ones. Its ETA accuracy in novel traffic situations will be higher than ours, particularly in the early stages before ShieldTrack has accumulated real trip data for retraining.

### What you gain

- Predictions that learn the _specific_ patterns of your routes — stop dwell times, school-zone congestion, the specific roads your buses take
- A confidence score that Google Maps does not provide
- Zero per-request cost that stays flat as you scale from 10 to 1,000 buses
- Full control over the model — you can retrain on real data as it accumulates

---

## 16. Troubleshooting

**`Could not import module "main"`**

You are running `uvicorn` from the wrong directory. The terminal must be inside the `shieldtrack_ml` folder when you run the command. Run `ls` (or `dir` on Windows) and confirm you see `main.py` before running uvicorn.

```bash
cd path/to/shieldtrack_ml
uvicorn main:app --reload --port 8000
```

**`Model file not found at 'eta_model.pkl'`**

You have not yet run the training scripts, or you ran them from a different directory. Run these from inside `shieldtrack_ml`:

```bash
python generate_synthetic_data.py
python train_eta_model.py
```

**`supabase_written: false` in responses**

The server could not reach Supabase. Check that `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in your `.env` file are correct and that you used the `service_role` key (not the `anon` key).

**`ModuleNotFoundError: No module named 'fastapi'`**

The virtual environment is not active, or you did not run `pip install -r requirements.txt`. Activate the venv and reinstall:

```bash
.venv\Scripts\activate         # Windows
source .venv/bin/activate      # macOS / Linux
pip install -r requirements.txt
```

**Port 8000 already in use**

Another process is using port 8000. Either stop that process or run the server on a different port:

```bash
uvicorn main:app --reload --port 8001
```

If using port 8001, update the URL in `simulate-bus.js` and any other callers to match.

**Predictions appear in Supabase but apps don't update**

Realtime is not enabled on the prediction tables. Go to Supabase Dashboard → Database → Replication and toggle on `bus_eta_predictions` and `bus_route_recommendations`.

---

## 17. File-by-file reference

### `config.py`

Reads all environment variables from `.env` and exposes them as a `Settings` object. Every other file imports from here rather than reading `os.getenv()` directly. This means you can see all configuration in one place and change a setting without hunting through the codebase.

### `predictor.py`

Owns the ML model lifecycle. At startup, `predictor.load()` reads `eta_model.pkl` from disk and keeps the model object in memory. The `predict()` method accepts raw feature values, builds a properly-ordered DataFrame, runs inference, and returns `eta_minutes` plus `confidence_pct`. Loading once at startup (not per request) means each prediction costs under 1ms rather than ~100ms.

### `router.py`

Implements the route optimization engine. Defines the road graph as a set of waypoints and adjacency lists, implements Haversine distance calculation, and runs Dijkstra's algorithm with time-of-day congestion factors applied to edge weights. Returns a ranked list of `RouteOption` objects. In a production version, the hardcoded demo graph would be replaced with a real OSM road network loaded via the `osmnx` library.

### `supabase_writer.py`

Handles all outbound communication to Supabase. Contains two async functions — `write_eta_prediction()` and `write_route_recommendation()` — that POST to Supabase's REST API using the service role key. Also contains `get_latest_traffic_delay()` which calls the Google Maps Distance Matrix API (or returns a simulated value if the key is set to `mock`). All functions return `True` or `False` — a failed write is logged but never crashes the server.

### `main.py`

The FastAPI application entry point. Defines all HTTP endpoints, Pydantic request/response schemas, CORS middleware, and the startup event that loads the model. Imports from all other modules and orchestrates the prediction pipeline: receive request → resolve traffic delay → run ML inference → write to Supabase → return response.

### `generate_synthetic_data.py`

Standalone script run once before training. Simulates 2,000 bus trips across 5 routes, sampling snapshots at 8 points during each trip. Applies per-hour congestion multipliers, random noise, and stop dwell time to produce 16,000 realistic training rows. Saves to `training_data.csv`.

### `train_eta_model.py`

Standalone script run once after data generation. Loads `training_data.csv`, splits into train/test sets, trains a `GradientBoostingRegressor`, evaluates MAE and R², prints a feature importance breakdown, runs sanity-check predictions on three scenarios, and saves the model bundle to `eta_model.pkl`.

---
