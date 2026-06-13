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
    monkeypatch.setattr(server, "telegram_bot_status", "polling")
    monkeypatch.setattr(server, "telegram_bot_last_error", None)
    monkeypatch.setattr(server, "telegram_bot_started_at", "2026-06-13T09:00:00+00:00")

    status = server._telegram_runtime_status()

    assert status["enabled"] is True
    assert status["polling"] is True
    assert status["status"] == "polling"
    assert status["last_error"] is None
    assert status["started_at"] == "2026-06-13T09:00:00+00:00"
    assert status["bot_username"] == "poriadok_bot"
    assert "secret-token" not in repr(status)
    assert "next_morning_summary_at" in status
    assert "next_overdue_cleanup_at" in status


def test_overdue_cleanup_message_requires_tasks_older_than_two_days(monkeypatch):
    async def collect_tasks(user_id, *, target_date=None, overdue=False):
        assert overdue is True
        return [
            {"title": "старий таск", "date": "2026-06-09", "event_title": ""},
            {"title": "ще норм", "date": "2026-06-10", "event_title": ""},
        ]

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 6, 12, 12, 0, tzinfo=tz)

    monkeypatch.setattr(server, "_collect_user_tasks", collect_tasks)
    monkeypatch.setattr(server, "datetime", FixedDateTime)

    message = server.asyncio.run(server._build_overdue_cleanup_message("marketer"))

    assert "во, бачу протерміновані таски" in message
    assert "старий таск" in message
    assert "(+1)" not in message


def test_telegram_message_preview_marks_unlinked_as_not_would_send(monkeypatch):
    async def status_payload(user_id):
        return {"linked": False, "muted": False}

    async def morning_summary(user_id):
        return "доброго ранку"

    monkeypatch.setattr(server, "_telegram_status_payload", status_payload)
    monkeypatch.setattr(server, "_build_morning_summary", morning_summary)

    preview = server.asyncio.run(server._telegram_message_preview("morning", "smm"))

    assert preview["kind"] == "morning"
    assert preview["count"] == 1
    assert preview["previews"][0]["user_id"] == "smm"
    assert preview["previews"][0]["would_send"] is False
    assert preview["previews"][0]["message"] == "доброго ранку"


def test_telegram_message_preview_accepts_dashed_overdue_cleanup(monkeypatch):
    async def status_payload(user_id):
        return {"linked": True, "muted": False}

    async def overdue_cleanup(user_id):
        return f"cleanup for {user_id}"

    monkeypatch.setattr(server, "_telegram_status_payload", status_payload)
    monkeypatch.setattr(server, "_build_overdue_cleanup_message", overdue_cleanup)

    preview = server.asyncio.run(server._telegram_message_preview("overdue-cleanup", "manager"))

    assert preview["kind"] == "overdue_cleanup"
    assert preview["count"] == 1
    assert preview["previews"][0]["would_send"] is True
    assert preview["previews"][0]["message"] == "cleanup for manager"


def test_telegram_keyboard_uses_human_labels_when_dependency_is_loaded():
    keyboard = server._telegram_main_keyboard()
    if keyboard is None:
        assert server.ReplyKeyboardMarkup is None
        return

    labels = [button for row in keyboard.keyboard for button in row]

    assert "сьогодні" in labels
    assert "протерміновано" in labels
    assert "відвʼязати" in labels
    assert "/today" not in labels


def test_telegram_text_actions_cover_main_buttons():
    assert server.TELEGRAM_TEXT_ACTIONS["сьогодні"] == "today"
    assert server.TELEGRAM_TEXT_ACTIONS["протерміновано"] == "overdue"
    assert server.TELEGRAM_TEXT_ACTIONS["вимкнути"] == "mute"
    assert server.TELEGRAM_TEXT_ACTIONS["увімкнути"] == "unmute"
    assert server.TELEGRAM_TEXT_ACTIONS["відвʼязати"] == "unlink"
