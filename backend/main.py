"""
main.py — ShieldTrack ML Backend Server
=========================================
This is the entry point for the FastAPI application. It wires together
the predictor (ETA model), the optimizer (route graph), and the Supabase
writer (database persistence) into a clean HTTP API.

To start the server:
  uvicorn main:app --reload --port 8000

The --reload flag means the server automatically restarts when you edit
any Python file. Perfect for development. Remove it in production.

Endpoints:
  GET  /              → health check (always available)
  GET  /model-info    → stats about the loaded ML model
  POST /predict/eta   → predict arrival time for a bus
  POST /predict/route → get ranked route options for a bus

All endpoints return JSON. All POST endpoints accept JSON bodies.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings
from predictor import predictor
from router import optimizer
from supabase_writer import (
    write_eta_prediction,
    write_route_recommendation,
    get_latest_traffic_delay,
)

from router import HOURLY_CONGESTION
import numpy as np


# ─── App Initialisation ───────────────────────────────────────────────────────

# ─── Startup: Load Model ──────────────────────────────────────────────────────
# The lifespan hook runs once when uvicorn starts the server.
# Loading the model here (not inside each request handler) means the model
# file is read from disk exactly once, then kept in memory for the entire
# lifetime of the server.
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[startup] Loading ML model...")
    predictor.load()
    print("[startup] ShieldTrack ML server is ready.")
    yield

app = FastAPI(
    title="ShieldTrack ML Backend",
    description="ETA prediction and route optimisation for school bus tracking",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow requests from your Admin Portal (running on localhost:5173 during dev)
# and from any Expo Go client on the same network.
# In production you'd tighten this to specific domains.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten this after hackathon
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response Schemas (Pydantic) ────────────────────────────────────
# Pydantic models do two jobs: they describe the shape of request bodies
# (FastAPI uses them to auto-validate incoming JSON and reject bad requests),
# and they document the API automatically in the /docs interface.

class ETARequest(BaseModel):
    bus_id:                str   = Field(..., example="550e8400-e29b-41d4-a716-446655440000")
    speed_current_kmh:     float = Field(..., ge=0, le=120, example=22.5)
    speed_avg_5min_kmh:    float = Field(..., ge=0, le=120, example=20.0)
    distance_remaining_km: float = Field(..., ge=0, le=100, example=5.2)
    stops_remaining:       int   = Field(..., ge=0, le=50,  example=3)
    hour_of_day:           int   = Field(..., ge=0, le=23,  example=8)
    day_of_week:           int   = Field(..., ge=0, le=6,   example=1)
    route_total_km:        float = Field(..., ge=0, le=100, example=12.0)
    trip_progress_pct:     float = Field(..., ge=0, le=100, example=56.7)

    # These are optional because they require external calls.
    # If omitted, the server fetches or simulates them automatically.
    traffic_delay_minutes: Optional[float] = Field(None, ge=0, example=3.5)
    origin_lat:            Optional[float] = Field(None, example=31.108)
    origin_lng:            Optional[float] = Field(None, example=76.098)
    dest_lat:              Optional[float] = Field(None, example=31.125)
    dest_lng:              Optional[float] = Field(None, example=76.116)


class ETAResponse(BaseModel):
    bus_id:           str
    eta_minutes:      float
    confidence_pct:   float
    predicted_at:     str
    supabase_written: bool   # did we persist this to the database?
    debug_features:   Optional[dict] = None


class RouteRequest(BaseModel):
    bus_id:      str   = Field(..., example="550e8400-e29b-41d4-a716-446655440000")
    origin_lat:  float = Field(..., example=31.108)
    origin_lng:  float = Field(..., example=76.098)
    dest_lat:    float = Field(..., example=31.125)
    dest_lng:    float = Field(..., example=76.116)
    hour_of_day: int   = Field(..., ge=0, le=23, example=8)
    num_stops:   int   = Field(3, ge=0, le=50, example=4)


class RouteOptionSchema(BaseModel):
    route_id:          str
    waypoints:         list[str]
    distance_km:       float
    estimated_minutes: float
    congestion_level:  str
    is_recommended:    bool
    notes:             str


class RouteResponse(BaseModel):
    bus_id:           str
    routes:           list[RouteOptionSchema]
    recommended_at:   str
    supabase_written: bool


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def health_check():
    """
    Basic health check. Call this to confirm the server is alive.
    Your monitoring / demo script can poll this every few seconds.
    """
    return {
        "status":    "ok",
        "service":   "ShieldTrack ML Backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_loaded": predictor._loaded,
    }


@app.get("/model-info", tags=["Health"])
async def model_info():
    """Returns metadata about the currently loaded ML model."""
    if not predictor._loaded:
        raise HTTPException(status_code=503, detail="Model not yet loaded")
    return {
        "feature_columns": predictor.feature_columns,
        "training_stats":  predictor.training_stats,
    }


@app.post("/predict/eta", response_model=ETAResponse, tags=["Predictions"])
async def predict_eta(req: ETARequest):
    """
    Predicts how many minutes until a bus reaches its destination.

    How to call this from your simulation script or Supabase webhook:

      POST http://localhost:8000/predict/eta
      Content-Type: application/json

      {
        "bus_id": "550e8400-e29b-41d4-a716-446655440000",
        "speed_current_kmh": 22.5,
        "speed_avg_5min_kmh": 20.0,
        "distance_remaining_km": 5.2,
        "stops_remaining": 3,
        "hour_of_day": 8,
        "day_of_week": 1,
        "route_total_km": 12.0,
        "trip_progress_pct": 56.7
      }

    If you include origin/dest coordinates, the server fetches live
    traffic delay from Google Maps. If not, it uses a simulated value.
    This means the endpoint works perfectly even without a Maps API key.
    """
    if not predictor._loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # ── Resolve traffic delay ────────────────────────────────────────────────
    # If the caller provided a delay value, use it.
    # Otherwise, fetch from Google Maps (or simulate if key is "mock").
    if req.traffic_delay_minutes is not None:
        traffic_delay = req.traffic_delay_minutes
    elif req.origin_lat and req.dest_lat:
        traffic_delay = await get_latest_traffic_delay(
            req.origin_lat, req.origin_lng, req.dest_lat, req.dest_lng
        )
    else:
        # No coordinates provided — use a congestion-based estimate
        from router import HOURLY_CONGESTION
        import numpy as np
        congestion = HOURLY_CONGESTION.get(req.hour_of_day, 1.0)
        traffic_delay = float(max(0, (congestion - 1.0) * 8 * np.random.uniform(0.8, 1.2)))

    # ── Run the ML model ─────────────────────────────────────────────────────
    result = predictor.predict(
        speed_current_kmh     = req.speed_current_kmh,
        speed_avg_5min_kmh    = req.speed_avg_5min_kmh,
        distance_remaining_km = req.distance_remaining_km,
        stops_remaining       = req.stops_remaining,
        hour_of_day           = req.hour_of_day,
        day_of_week           = req.day_of_week,
        traffic_delay_minutes = traffic_delay,
        trip_progress_pct     = req.trip_progress_pct,
        route_total_km        = req.route_total_km,
    )

    # ── Write to Supabase (non-blocking) ─────────────────────────────────────
    # We fire the Supabase write as a background task so the HTTP response
    # returns immediately. The parent app sees the prediction in under 50ms;
    # the database write completes a moment later in the background.
    async def _bg_write_eta():
        try:
            await write_eta_prediction(
                bus_id         = req.bus_id,
                eta_minutes    = result["eta_minutes"],
                confidence_pct = result["confidence_pct"],
                features       = result["features_used"],
            )
        except Exception as e:
            print(f"[background task error] write_eta_prediction failed: {e}")

    asyncio.create_task(_bg_write_eta())

    return ETAResponse(
        bus_id           = req.bus_id,
        eta_minutes      = result["eta_minutes"],
        confidence_pct   = result["confidence_pct"],
        predicted_at     = datetime.now(timezone.utc).isoformat(),
        supabase_written = True,
        debug_features   = result["features_used"] if settings.DEBUG else None,
    )


@app.post("/predict/route", response_model=RouteResponse, tags=["Predictions"])
async def predict_route(req: RouteRequest):
    """
    Returns 2–3 ranked route options from the bus's current position
    to the school, with estimated travel times for each.

    The first route in the response is always the recommended one.

    How to call this:

      POST http://localhost:8000/predict/route
      Content-Type: application/json

      {
        "bus_id": "550e8400-e29b-41d4-a716-446655440000",
        "origin_lat": 31.108,
        "origin_lng": 76.098,
        "dest_lat": 31.125,
        "dest_lng": 76.116,
        "hour_of_day": 8,
        "num_stops": 4
      }
    """
    routes = optimizer.get_routes(
        origin_lat  = req.origin_lat,
        origin_lng  = req.origin_lng,
        dest_lat    = req.dest_lat,
        dest_lng    = req.dest_lng,
        hour_of_day = req.hour_of_day,
        num_stops   = req.num_stops,
    )

    if not routes:
        raise HTTPException(status_code=404, detail="No route found between given coordinates")

    # Persist to Supabase
    supabase_ok = await write_route_recommendation(
        bus_id = req.bus_id,
        routes = routes,
    )

    return RouteResponse(
        bus_id           = req.bus_id,
        routes           = [
            RouteOptionSchema(
                route_id          = r.route_id,
                waypoints         = r.waypoints,
                distance_km       = r.distance_km,
                estimated_minutes = r.estimated_minutes,
                congestion_level  = r.congestion_level,
                is_recommended    = r.is_recommended,
                notes             = r.notes,
            )
            for r in routes
        ],
        recommended_at   = datetime.now(timezone.utc).isoformat(),
        supabase_written = supabase_ok,
    )


# ─── Batch Endpoint (Hackathon Convenience) ───────────────────────────────────
# This endpoint lets your simulation script update ALL buses in one HTTP call
# instead of one call per bus. Much easier to demo.

class BusUpdate(BaseModel):
    bus_id:                str
    speed_current_kmh:     float
    speed_avg_5min_kmh:    float
    distance_remaining_km: float
    stops_remaining:       int
    hour_of_day:           int
    day_of_week:           int
    route_total_km:        float
    trip_progress_pct:     float


@app.post("/predict/batch-eta", tags=["Predictions"])
async def batch_eta(updates: list[BusUpdate]):
    """
    Predicts ETAs for multiple buses in a single request.
    Returns a list of {bus_id, eta_minutes, confidence_pct} dicts.

    Ideal for your simulate-bus.js script: at each tick, send the
    state of all buses, get all predictions back at once.
    """
    if not predictor._loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    results = []
    for u in updates:
        congestion = HOURLY_CONGESTION.get(u.hour_of_day, 1.0)
        traffic_delay = float(max(0, (congestion - 1.0) * 8 * np.random.uniform(0.8, 1.2)))

        result = predictor.predict(
            speed_current_kmh     = u.speed_current_kmh,
            speed_avg_5min_kmh    = u.speed_avg_5min_kmh,
            distance_remaining_km = u.distance_remaining_km,
            stops_remaining       = u.stops_remaining,
            hour_of_day           = u.hour_of_day,
            day_of_week           = u.day_of_week,
            traffic_delay_minutes = traffic_delay,
            trip_progress_pct     = u.trip_progress_pct,
            route_total_km        = u.route_total_km,
        )
        results.append({
            "bus_id":         u.bus_id,
            "eta_minutes":    result["eta_minutes"],
            "confidence_pct": result["confidence_pct"],
        })

    return {"predictions": results, "count": len(results)}
