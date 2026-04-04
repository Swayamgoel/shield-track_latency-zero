"""
config.py — Centralised settings loader
========================================
All configuration lives here. The rest of the app imports from
this module rather than reading environment variables directly.
This makes it easy to change a setting in one place, and to see
at a glance everything the server depends on.
"""

import os
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

class Settings:
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    GOOGLE_MAPS_API_KEY: str
    MODEL_PATH: str
    BUS_STALE_THRESHOLD: int
    DEBUG: bool

    def __init__(self):
        self.SUPABASE_URL = os.getenv("SUPABASE_URL")
        if not self.SUPABASE_URL:
            raise ValueError("Missing required environment variable: SUPABASE_URL")

        self.SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
        if not self.SUPABASE_SERVICE_KEY:
            raise ValueError("Missing required environment variable: SUPABASE_SERVICE_KEY")

        self.GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "mock")
        self.MODEL_PATH = os.getenv("MODEL_PATH", "eta_model.pkl")

        bus_stale_str = os.getenv("BUS_STALE_THRESHOLD_SECONDS", "60")
        try:
            self.BUS_STALE_THRESHOLD = int(bus_stale_str)
        except ValueError:
            raise ValueError(f"Invalid BUS_STALE_THRESHOLD_SECONDS: '{bus_stale_str}'. Must be an integer.")

        self.DEBUG = os.getenv("DEBUG", "false").lower() == "true"

settings = Settings()
