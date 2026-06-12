import importlib
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "poriadok_test")

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

server = importlib.import_module("server")


def test_next_telegram_run_rolls_to_same_day_before_target():
    now = datetime(2026, 6, 12, 8, 59, tzinfo=ZoneInfo("Europe/Kyiv"))

    target = server._next_telegram_run_at(9, 0, now)

    assert target.isoformat() == "2026-06-12T09:00:00+03:00"


def test_next_telegram_run_rolls_to_next_day_after_target():
    now = datetime(2026, 6, 12, 9, 0, tzinfo=ZoneInfo("Europe/Kyiv"))

    target = server._next_telegram_run_at(9, 0, now)

    assert target.isoformat() == "2026-06-13T09:00:00+03:00"


def test_telegram_runtime_status_exposes_no_token_value(monkeypatch):
    monkeypatch.setattr(server, "TELEGRAM_BOT_TOKEN", "secret-token")
    monkeypatch.setattr(server, "TELEGRAM_BOT_USERNAME", "poriadok_bot")
    monkeypatch.setattr(server, "telegram_app", object())

    status = server._telegram_runtime_status()

    assert status["enabled"] is True
    assert status["polling"] is True
    assert status["bot_username"] == "poriadok_bot"
    assert "secret-token" not in repr(status)
    assert "next_morning_summary_at" in status
    assert "next_overdue_cleanup_at" in status
