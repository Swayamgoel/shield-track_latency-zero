"""
ShieldTrack — Synthetic Training Data Generator
================================================
This script generates realistic fake bus trip "snapshots" to train
the ETA prediction model. Each row represents a moment mid-trip
where we know the features AND the actual time remaining.

Think of it like this: for a 20-minute trip, we might generate
10-15 snapshots at different points along the way. Each snapshot
answers the question "given what we can observe right now,
how many minutes until the bus reaches school?"
"""

import pandas as pd
import numpy as np
import random

# ─── Reproducibility ───────────────────────────────────────────────────────
# Setting a seed means you get the same "random" data every time you run
# this script. Crucial for debugging and for sharing with teammates.
np.random.seed(42)
random.seed(42)


# ─── LAYER 1: Congestion Model ─────────────────────────────────────────────
# This is the heart of your realism. Real school buses are slowest during
# morning and afternoon rush hours. We model this as a multiplier on travel
# time — 1.0 means normal, 1.8 means 80% slower than normal.
#
# The values below are educated guesses. In a real system you'd calibrate
# these against actual traffic data for your city. For the hackathon,
# reasonable guesses are completely fine.

HOURLY_CONGESTION = {
    0:  1.0,  # midnight — empty roads
    1:  1.0,
    2:  1.0,
    3:  1.0,
    4:  1.0,
    5:  1.1,  # early risers starting to appear
    6:  1.3,  # morning rush begins
    7:  1.7,  # peak morning rush (buses are out)
    8:  1.8,  # heaviest congestion — school start time
    9:  1.4,  # settling down after drop-off
    10: 1.1,
    11: 1.0,
    12: 1.1,  # lunch hour, slight pickup
    13: 1.1,
    14: 1.2,
    15: 1.6,  # afternoon pickup begins
    16: 1.9,  # peak afternoon rush (school dismissal)
    17: 1.7,
    18: 1.4,
    19: 1.2,
    20: 1.1,
    21: 1.0,
    22: 1.0,
    23: 1.0,
}

# School buses mostly run Mon–Fri. Weekends are much lighter traffic.
DAY_MULTIPLIER = {
    0: 1.0,   # Monday
    1: 1.0,   # Tuesday
    2: 1.0,   # Wednesday
    3: 1.05,  # Thursday (slightly heavier for some reason — it just is)
    4: 1.1,   # Friday (people leaving early, road trips starting)
    5: 0.7,   # Saturday
    6: 0.6,   # Sunday
}


def get_congestion_factor(hour: int, day_of_week: int) -> float:
    """
    Returns a multiplier for how congested traffic is right now.
    A value of 1.8 means a journey takes 1.8x its free-flow time.
    
    We also add a small random perturbation — even the same hour on
    the same day isn't perfectly consistent.
    """
    base = HOURLY_CONGESTION[hour]
    day_adj = DAY_MULTIPLIER[day_of_week]
    # Add ±10% random noise to simulate day-to-day unpredictability
    noise = np.random.uniform(0.9, 1.1)
    return base * day_adj * noise


# ─── LAYER 2: Route Config ─────────────────────────────────────────────────
# A "route" is just a total distance and a number of stops.
# You'd replace these with real routes from your app's database eventually.

ROUTES = [
    {"route_id": "R1", "total_distance_km": 8.5,  "num_stops": 6},
    {"route_id": "R2", "total_distance_km": 12.0, "num_stops": 9},
    {"route_id": "R3", "total_distance_km": 5.5,  "num_stops": 4},
    {"route_id": "R4", "total_distance_km": 15.0, "num_stops": 11},
    {"route_id": "R5", "total_distance_km": 7.0,  "num_stops": 5},
]

# Each stop takes some time for the bus to wait (kids boarding/alighting).
# This is sampled from a range to add realism.
STOP_DWELL_TIME_SECONDS = (30, 90)   # min, max

# Free-flow speed of a school bus in urban/suburban areas (km/h).
FREE_FLOW_SPEED_KMH = 35


# ─── LAYER 3: Trip Snapshot Generator ─────────────────────────────────────

def simulate_trip(route: dict, hour: int, day_of_week: int) -> list[dict]:
    """
    Simulates one full bus trip and returns multiple snapshot rows.
    
    Why multiple rows per trip? Because the model needs to learn how to
    predict ETA at ANY point during a trip — whether the bus just left
    or is 2 stops away from school. So we sample several moments along
    the journey and record the features + actual remaining time at each.
    
    Returns a list of dicts, each one being a training example.
    """
    
    congestion = get_congestion_factor(hour, day_of_week)
    effective_speed = FREE_FLOW_SPEED_KMH / congestion  # km/h, accounting for traffic
    
    total_dist = route["total_distance_km"]
    num_stops = route["num_stops"]
    
    # Calculate total travel time (driving only, not counting stops)
    driving_time_minutes = (total_dist / effective_speed) * 60
    
    # Calculate total stop time (sum of all dwell times)
    stop_times = [random.randint(*STOP_DWELL_TIME_SECONDS) for _ in range(num_stops)]
    total_stop_time_minutes = sum(stop_times) / 60
    
    # True total trip time (what we're trying to predict from the start)
    true_total_time = driving_time_minutes + total_stop_time_minutes
    
    # Now simulate the rolling average speed a tracker would observe.
    # In practice the GPS logger computes this; here we approximate it.
    avg_speed_kmh = effective_speed + np.random.normal(0, 2)  # small measurement noise
    avg_speed_5min = avg_speed_kmh * np.random.uniform(0.85, 1.15)  # even noisier rolling window
    
    # Google Maps API would tell us roughly how delayed traffic is.
    # We simulate this as a fraction of the congestion-induced delay.
    base_time_no_traffic = (total_dist / FREE_FLOW_SPEED_KMH) * 60
    traffic_delay_minutes = (driving_time_minutes - base_time_no_traffic) * np.random.uniform(0.7, 1.3)
    traffic_delay_minutes = max(0, traffic_delay_minutes)  # can't be negative
    
    # ── Generate snapshots at different points in the trip ──────────────────
    # We'll take snapshots at roughly every 20% of the trip's distance.
    # Each snapshot = "what does the system see at this moment?"
    
    snapshots = []
    progress_points = np.linspace(0.05, 0.90, 8)  # 8 snapshots, from 5% to 90% complete
    
    for progress in progress_points:
        dist_covered = total_dist * progress
        dist_remaining = total_dist - dist_covered
        
        # How many stops are ahead of us at this point in the trip?
        stops_completed = int(progress * num_stops)
        stops_remaining = num_stops - stops_completed
        
        # True remaining time: remaining driving time + remaining stop time
        remaining_driving_time = (dist_remaining / effective_speed) * 60
        remaining_stop_time = sum(stop_times[stops_completed:]) / 60
        actual_eta_minutes = remaining_driving_time + remaining_stop_time
        
        # Add final noise — the real world is never perfectly modeled
        actual_eta_minutes += np.random.normal(0, 1.5)
        actual_eta_minutes = max(0.5, actual_eta_minutes)  # can't arrive in the past
        
        snapshots.append({
            # ── Features (inputs to the model) ───────────────────────────
            "speed_current_kmh":      round(avg_speed_kmh + np.random.normal(0, 3), 2),
            "speed_avg_5min_kmh":     round(avg_speed_5min, 2),
            "distance_remaining_km":  round(dist_remaining, 3),
            "stops_remaining":        stops_remaining,
            "hour_of_day":            hour,
            "day_of_week":            day_of_week,        # 0=Mon, 6=Sun
            "is_peak_hour":           int(hour in [7, 8, 15, 16]),  # 1 or 0
            "traffic_delay_minutes":  round(traffic_delay_minutes * (1 - progress), 2),
            "trip_progress_pct":      round(progress * 100, 1),
            "route_total_km":         total_dist,
            
            # ── Label (what we're trying to predict) ─────────────────────
            "actual_eta_minutes":     round(actual_eta_minutes, 2),
            
            # ── Metadata (not used in training, useful for debugging) ─────
            "route_id":               route["route_id"],
            "congestion_factor":      round(congestion, 3),
        })
    
    return snapshots


# ─── MAIN: Generate the Full Dataset ───────────────────────────────────────

def generate_dataset(num_trips: int = 2000) -> pd.DataFrame:
    """
    Generates `num_trips` simulated bus trips and returns all
    their snapshots as a single DataFrame ready for model training.
    
    2000 trips × 8 snapshots each = 16,000 training rows.
    That's more than enough for a Gradient Boosting model to learn from.
    """
    
    all_rows = []
    
    # School buses mostly run during two windows: morning (6–9 AM) and
    # afternoon (2–5 PM). We weight our random hour sampling to reflect this.
    morning_hours = [6, 7, 8, 9]
    afternoon_hours = [14, 15, 16, 17]
    other_hours = [10, 11, 12, 13]
    
    # 45% morning, 45% afternoon, 10% other (field trips, etc.)
    hour_pool = (morning_hours * 45) + (afternoon_hours * 45) + (other_hours * 10)
    
    print(f"Generating {num_trips} synthetic trips...")
    
    for i in range(num_trips):
        route = random.choice(ROUTES)
        hour = random.choice(hour_pool)
        day = random.randint(0, 4)   # Mon–Fri only for school trips
        
        trip_snapshots = simulate_trip(route, hour, day)
        all_rows.extend(trip_snapshots)
        
        if (i + 1) % 500 == 0:
            print(f"  {i + 1}/{num_trips} trips done...")
    
    df = pd.DataFrame(all_rows)
    print(f"\nDone! Generated {len(df):,} training rows from {num_trips} trips.")
    print(f"ETA range: {df['actual_eta_minutes'].min():.1f} – {df['actual_eta_minutes'].max():.1f} minutes")
    print(f"Average ETA: {df['actual_eta_minutes'].mean():.1f} minutes")
    return df

if __name__ == "__main__":
    df = generate_dataset(num_trips=2000)
    
    # Save to CSV — this file is what you feed to the training script next
    output_path = "training_data.csv"
    df.to_csv(output_path, index=False)
    print(f"\nSaved to {output_path}")
    print(f"\nFirst few rows:\n{df.head(3).to_string()}")
    print(f"\nColumn summary:\n{df.describe().round(2).to_string()}")
