import pandas as pd
import numpy as np
import random

# Define columns (IMPORTANT)
columns = [
    "speed_current",
    "speed_avg",
    "distance_remaining",
    "stops_remaining",
    "hour",
    "day",
    "is_peak",
    "traffic_delay",
    "progress",
    "route_total",
    "eta"
]

# Load or create file
try:
    df_existing = pd.read_csv('training_data.csv')
except:
    df_existing = pd.DataFrame(columns=columns)

NEW_ROWS = 35000
data = []

for _ in range(NEW_ROWS):
    speed_current = np.random.uniform(10, 40)
    speed_avg = speed_current + np.random.normal(0, 3)

    distance_remaining = np.random.uniform(0.5, 15)
    stops_remaining = random.randint(0, 10)

    hour = random.randint(0, 23)
    day = random.randint(0, 6)

    is_peak = 1 if hour in [7,8,15,16] else 0

    traffic_delay = np.random.uniform(3, 10) if is_peak else np.random.uniform(0, 5)

    route_total = distance_remaining + np.random.uniform(2, 10)
    progress = (1 - distance_remaining / route_total) * 100

    base_time = distance_remaining / max(speed_current, 5) * 60
    stop_time = stops_remaining * np.random.uniform(0.5, 1.5)
    eta = base_time + stop_time + traffic_delay

    data.append([
        speed_current,
        speed_avg,
        distance_remaining,
        stops_remaining,
        hour,
        day,
        is_peak,
        traffic_delay,
        progress,
        route_total,
        eta
    ])

df_new = pd.DataFrame(data, columns=columns)

df_final = pd.concat([df_existing, df_new], ignore_index=True)

df_final.to_csv('training_data.csv', index=False)

print("✅ Done! Total rows:", len(df_final))