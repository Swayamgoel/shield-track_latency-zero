"""
supabase_writer.py — Writes ML predictions back to Supabase
=============================================================
After computing an ETA or route recommendation, the server needs
to persist those predictions so your React Native apps can read
them via their existing Realtime subscriptions.

Why write back to Supabase instead of returning predictions directly
to the apps? Because your apps don't call this server. The flow is:

  Driver app → Supabase (GPS row) → this server → Supabase (prediction row)
                                                         ↓
                                              Parent app (via Realtime)
                                              Admin portal (via Realtime)

This design keeps your mobile apps simple — they only ever talk to
Supabase, which they already know how to do. The ML server is an
invisible backend enhancement.

The table schemas expected in Supabase:

  CREATE TABLE bus_eta_predictions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_id         TEXT NOT NULL,
    eta_minutes    NUMERIC NOT NULL,
    confidence_pct NUMERIC NOT NULL,
    predicted_at   TIMESTAMPTZ DEFAULT now(),
    features_json  JSONB
  );

  CREATE TABLE bus_route_recommendations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_id         TEXT NOT NULL,
    recommended_at TIMESTAMPTZ DEFAULT now(),
    routes_json    JSONB NOT NULL
  );

  -- Enable Realtime on both tables in Supabase Dashboard > Database > Replication
"""

import json
import httpx
from dataclasses import asdict
from config import settings


async def write_eta_prediction(
    bus_id:         str,
    eta_minutes:    float,
    confidence_pct: float,
    features:       dict,
) -> bool:
    """
    Inserts one ETA prediction row into Supabase.
    Returns True on success, False on failure (the server
    continues running either way — a failed write is logged
    but should not crash the prediction endpoint).
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        # Supabase not configured — log and skip silently.
        # This is normal during local development before you've set up .env.
        print("[supabase] Supabase not configured, skipping write.")
        return False

    url = f"{settings.SUPABASE_URL}/rest/v1/bus_eta_predictions"
    headers = {
        "apikey":        settings.SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",  # don't return the inserted row (faster)
    }
    payload = {
        "bus_id":         bus_id,
        "eta_minutes":    eta_minutes,
        "confidence_pct": confidence_pct,
        "features_json":  features,
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            return True
    except httpx.HTTPStatusError as e:
        print(f"[supabase] HTTP error writing ETA: {e.response.status_code} {e.response.text}")
        return False
    except Exception as e:
        print(f"[supabase] Unexpected error writing ETA: {e}")
        return False


async def write_route_recommendation(bus_id: str, routes: list) -> bool:
    """
    Inserts one route recommendation (containing 2-3 options) into Supabase.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        print("[supabase] Supabase not configured, skipping write.")
        return False

    url = f"{settings.SUPABASE_URL}/rest/v1/bus_route_recommendations"
    headers = {
        "apikey":        settings.SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
    }
    # Convert RouteOption dataclasses to plain dicts for JSON serialisation
    routes_as_dicts = [asdict(r) for r in routes]
    payload = {
        "bus_id":      bus_id,
        "routes_json": routes_as_dicts,
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            return True
    except httpx.HTTPStatusError as e:
        print(f"[supabase] HTTP error writing route: {e.response.status_code} {e.response.text}")
        return False
    except Exception as e:
        print(f"[supabase] Unexpected error writing route: {e}")
        return False


async def get_latest_traffic_delay(
    origin_lat: float,
    origin_lng: float,
    dest_lat:   float,
    dest_lng:   float,
) -> float:
    """
    Fetches live traffic delay (in minutes) from Google Maps Distance Matrix API.
    Falls back to a simulated value if the key is not configured (set to "mock").

    We use the *difference* between duration_in_traffic and duration as the
    delay signal. This is exactly what we fed the model during training.
    """
    if settings.GOOGLE_MAPS_API_KEY == "mock":
        # Simulate a plausible traffic delay for demo purposes
        from datetime import datetime
        hour = datetime.now().hour
        base_delay = {7: 4.5, 8: 6.0, 9: 3.0, 15: 5.0, 16: 7.0, 17: 5.5}
        delay = base_delay.get(hour, 1.5)
        import numpy as np
        return float(delay * np.random.uniform(0.8, 1.2))

    url = "https://maps.googleapis.com/maps/api/distancematrix/json"
    params = {
        "origins":                  f"{origin_lat},{origin_lng}",
        "destinations":             f"{dest_lat},{dest_lng}",
        "departure_time":           "now",
        "traffic_model":            "best_guess",
        "key":                      settings.GOOGLE_MAPS_API_KEY,
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            
            if data.get("status") != "OK":
                print(f"[maps] API returned non-OK status. Response: {data}")
                return 2.0
                
            rows = data.get("rows", [])
            if not rows or not rows[0].get("elements"):
                print(f"[maps] Missing rows/elements in response. Response: {data}")
                return 2.0
                
            element = rows[0]["elements"][0]
            if "duration" not in element or "value" not in element["duration"]:
                print(f"[maps] Missing duration.value in element. Response: {data}")
                return 2.0
                
            duration_secs = element["duration"]["value"]
            traffic_secs  = element.get("duration_in_traffic", {}).get("value", duration_secs)
            delay_minutes = max(0, (traffic_secs - duration_secs) / 60)
            return round(delay_minutes, 2)
    except Exception as e:
        print(f"[maps] Error fetching traffic: {e}, using mock value")
        return 2.0
