from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne
import os
import logging
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone, timedelta, date
import random
import requests
import httpx
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo
import html

try:
    from telegram import ReplyKeyboardMarkup, Update
    from telegram.ext import Application, CommandHandler, ContextTypes
except Exception:  # pragma: no cover - keeps the API alive when TG deps are absent
    ReplyKeyboardMarkup = None
    Update = None
    Application = None
    CommandHandler = None
    ContextTypes = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
import certifi
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
db = client[os.environ['DB_NAME']]

# Altegio configuration
ALTEGIO_BASE_URL = "https://api.alteg.io/api/v1"
ALTEGIO_BASE_URL_V2 = "https://api.alteg.io/api/v2"
ALTEGIO_COMPANY_ID = os.environ.get("ALTEGIO_COMPANY_ID", "1187362")
ALTEGIO_USER_TOKEN = os.environ.get("ALTEGIO_USER_TOKEN", "")
ALTEGIO_PUSH_USER_TOKEN = os.environ.get("ALTEGIO_PUSH_USER_TOKEN", "") or ALTEGIO_USER_TOKEN
ALTEGIO_PARTNER_TOKEN = os.environ.get("ALTEGIO_PARTNER_TOKEN", "")
ALTEGIO_DEFAULT_SERVICE_ID = int(os.environ.get("ALTEGIO_DEFAULT_SERVICE_ID", "0"))
ALTEGIO_DEFAULT_STAFF_ID = int(os.environ.get("ALTEGIO_DEFAULT_STAFF_ID", "0"))

# Background task for Altegio auto-sync
altegio_sync_task = None

# Telegram notifications
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.environ.get("TELEGRAM_BOT_USERNAME", "")
TELEGRAM_TIMEZONE = os.environ.get("TELEGRAM_TIMEZONE", "Europe/Kyiv")
PORIADOK_APP_URL = (os.environ.get("FRONTEND_URL") or "https://app.sensa.events").rstrip("/")

telegram_app = None
telegram_summary_task = None
TEAM_USERS = ("manager", "smm", "marketer")
TEAM_USER_LABELS = {
    "manager": "Manager",
    "smm": "SMM",
    "marketer": "Marketer",
}
LEGACY_ASSIGNEE_ALIASES = {
    "manager": "manager",
    "management": "manager",
    "karolina": "manager",
    "smm": "smm",
    "kasya": "smm",
    "marketer": "marketer",
    "marketing": "marketer",
    "vo": "marketer",
}
ASSIGNEE_STORAGE_ALIASES = {
    "manager": ["manager", "karolina"],
    "smm": ["smm", "kasya"],
    "marketer": ["marketer", "vo"],
}


def normalize_assignee(value: Optional[str], default: str = "manager") -> str:
    raw = (value or "").strip().lower()
    return LEGACY_ASSIGNEE_ALIASES.get(raw, default)


def assignee_storage_aliases(value: str) -> List[str]:
    return ASSIGNEE_STORAGE_ALIASES.get(normalize_assignee(value), [normalize_assignee(value)])

async def altegio_auto_sync():
    """Background task to sync Altegio data every 60 minutes"""
    while True:
        try:
            await asyncio.sleep(60 * 60)  # Wait 60 minutes
            logging.info("Starting scheduled Altegio sync...")
            
            if not ALTEGIO_USER_TOKEN:
                logging.warning("Altegio token not configured, skipping sync")
                continue
            
            altegio_events = await altegio_client.get_group_events()
            synced_count, _ = await _sync_altegio_events_to_local(altegio_events)
            logging.info(f"Altegio auto-sync completed: {synced_count} events updated")
        except asyncio.CancelledError:
            logging.info("Altegio sync task cancelled")
            break
        except Exception as e:
            logging.error(f"Altegio auto-sync error: {e}")


def _telegram_enabled() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and Application and CommandHandler)


async def start_telegram_bot():
    """Start Telegram polling if the token is configured."""
    global telegram_app
    if not TELEGRAM_BOT_TOKEN:
        logging.info("Telegram bot disabled — TELEGRAM_BOT_TOKEN is not configured")
        return
    if not _telegram_enabled():
        logging.error("Telegram bot disabled — python-telegram-bot is not installed")
        return

    telegram_app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    telegram_app.add_handler(CommandHandler("start", telegram_start_command))
    telegram_app.add_handler(CommandHandler("link", telegram_link_command))
    telegram_app.add_handler(CommandHandler("today", telegram_today_command))
    telegram_app.add_handler(CommandHandler("overdue", telegram_overdue_command))
    telegram_app.add_handler(CommandHandler("mute", telegram_mute_command))
    telegram_app.add_handler(CommandHandler("unmute", telegram_unmute_command))

    await telegram_app.initialize()
    await telegram_app.start()
    if telegram_app.updater:
        await telegram_app.updater.start_polling(drop_pending_updates=True)
    logging.info("Telegram bot polling started")


async def stop_telegram_bot():
    global telegram_app
    if not telegram_app:
        return
    try:
        if telegram_app.updater:
            await telegram_app.updater.stop()
        await telegram_app.stop()
        await telegram_app.shutdown()
        logging.info("Telegram bot stopped")
    except Exception as e:
        logging.error(f"Telegram bot shutdown error: {e}")
    finally:
        telegram_app = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    global altegio_sync_task, telegram_summary_task
    # Load any task-definition overrides from DB into in-memory cache
    try:
        await _refresh_task_overrides_cache()
        logging.info(f"Loaded {len(_task_overrides)} task definition overrides")
    except Exception as e:
        logging.error(f"Failed to load task overrides on startup: {e}")
    # Startup: Start background sync task
    altegio_sync_task = asyncio.create_task(altegio_auto_sync())
    logging.info("Altegio auto-sync started (every 60 minutes)")
    
    # Run initial sync after 5 seconds
    async def initial_sync():
        await asyncio.sleep(5)
        if ALTEGIO_USER_TOKEN:
            logging.info("Running initial Altegio sync...")
            try:
                altegio_events = await altegio_client.get_group_events()
                synced_count, _ = await _sync_altegio_events_to_local(altegio_events)
                logging.info(f"Initial Altegio sync: {len(altegio_events)} events processed, {synced_count} events updated")
            except Exception as e:
                logging.error(f"Initial sync error: {e}")
    
    asyncio.create_task(initial_sync())
    
    # Auto-generate monthly tasks — check every 2 weeks, not on every restart
    async def auto_generate_monthly():
        await asyncio.sleep(3)
        now = datetime.now(timezone.utc)
        
        # Check if we ran this recently (within 2 weeks)
        last_check = await db.generated_months.find_one({"id": "last_monthly_check"})
        if last_check:
            last_checked_at = datetime.fromisoformat(last_check["checked_at"])
            if (now - last_checked_at).days < 14:
                logging.info(f"Monthly tasks check skipped — last check was {last_check['checked_at']}")
                return
        
        # Generate for current month and next month
        for offset in [0, 1]:
            target = now.replace(day=1) + timedelta(days=32 * offset)
            y, m = target.year, target.month
            month_key = f"{y}-{str(m).zfill(2)}"
            existing = await db.generated_months.find_one({"month_key": month_key})
            if not existing:
                calculated = calculate_monthly_tasks(y, m)
                column_to_assignee = {"management": "manager", "smm": "smm", "marketing": "marketer"}
                count = 0
                for task_id, task_info in calculated.items():
                    assignee = column_to_assignee.get(task_info["column"], "manager")
                    standalone = {
                        "id": f"monthly-{month_key}-{task_id}",
                        "title": task_info["name"],
                        "date": task_info["date"],
                        "icon": "calendar",
                        "type": "monthly",
                        "color": "standard",
                        "assignee": assignee,
                        "completed": False,
                        "completed_at": None,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "monthly_source": task_id,
                        "target_month": month_key,
                        "column": task_info["column"],
                    }
                    await db.standalone_tasks.update_one({"id": standalone["id"]}, {"$setOnInsert": standalone}, upsert=True)
                    count += 1
                await db.generated_months.update_one(
                    {"month_key": month_key},
                    {"$set": {"month_key": month_key, "generated_at": datetime.now(timezone.utc).isoformat(), "count": count}},
                    upsert=True
                )
                logging.info(f"Auto-generated {count} monthly tasks for {month_key}")
        
        # Update last check timestamp
        await db.generated_months.update_one(
            {"id": "last_monthly_check"},
            {"$set": {"id": "last_monthly_check", "checked_at": now.isoformat()}},
            upsert=True
        )
    
    asyncio.create_task(auto_generate_monthly())
    
    # Auto-generate daily tasks for today
    async def auto_generate_daily():
        await asyncio.sleep(4)
        now = datetime.now(timezone.utc)
        today_str = now.strftime("%Y-%m-%d")
        column_to_assignee = {"management": "manager", "smm": "smm", "marketing": "marketer"}
        for task in DAILY_TASKS:
            task_id = f"daily-{today_str}-{task['id']}"
            existing = await db.standalone_tasks.find_one({"id": task_id})
            if not existing:
                standalone = {
                    "id": task_id,
                    "title": task["name"],
                    "date": today_str,
                    "icon": "coffee" if task["column"] == "management" else "hash",
                    "type": "daily",
                    "color": "standard",
                    "assignee": column_to_assignee.get(task["column"], "manager"),
                    "completed": False,
                    "completed_at": None,
                    "created_at": now.isoformat(),
                    "daily_source": task["id"],
                    "column": task["column"],
                }
                await db.standalone_tasks.insert_one(standalone)
                logging.info(f"Auto-generated daily task: {task_id}")
    
    asyncio.create_task(auto_generate_daily())

    await start_telegram_bot()
    telegram_summary_task = asyncio.create_task(telegram_summary_loop())
    
    yield
    
    # Shutdown: Cancel background task
    if altegio_sync_task:
        altegio_sync_task.cancel()
        try:
            await altegio_sync_task
        except asyncio.CancelledError:
            pass
    logging.info("Altegio auto-sync stopped")

    if telegram_summary_task:
        telegram_summary_task.cancel()
        try:
            await telegram_summary_task
        except asyncio.CancelledError:
            pass
    await stop_telegram_bot()

app = FastAPI(lifespan=lifespan)
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================

DEFAULT_ALTEGIO_SERVICE_MAPPINGS = {
    # Stable Poriadok event-type keys -> Altegio service ids.
    # Can be overridden via /api/settings without code deploy.
    "kadli_short": 12999207,
    "kadli_medium": 13170797,
    "acro_yoga": 13294345,
}

class ReminderType(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    days_before: int
    icon: str = "bell"

class EventCreate(BaseModel):
    title: str
    date: str
    price: float
    description: str = ""
    spots: int = 10
    start_time: str = ""
    end_time: str = ""
    event_type: str = "new"  # "new", "regular", "repeat"
    repeat_days: List[int] = []  # for regular: weekday numbers (0=Mon...6=Sun)
    source_event_id: str = ""  # for repeat: ID of original event

class EventUpdate(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    price: Optional[float] = None
    description: Optional[str] = None
    spots: Optional[int] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    cancelled: Optional[bool] = None

class Event(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    date: str
    price: float
    description: str = ""
    spots: int = 10
    start_time: str = ""
    end_time: str = ""
    cancelled: bool = False
    archived: bool = False
    event_type: str = "new"  # "new", "regular", "repeat"
    repeat_days: List[int] = []
    source_event_id: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    reminders: Dict[str, str] = {}
    completed_tasks: Dict[str, str] = {}
    smm_tasks: Dict[str, str] = {}
    completed_smm_tasks: Dict[str, str] = {}
    marketing_tasks: Dict[str, str] = {}
    completed_marketing_tasks: Dict[str, str] = {}
    altegio_activity_id: Optional[str] = None
    # Altegio integration fields
    altegio_id: Optional[str] = None
    altegio_service_id: Optional[int] = None  # per-event Altegio service (overrides default)
    altegio_booked_count: Optional[int] = None
    altegio_last_sync: Optional[str] = None
    altegio_last_error: Optional[str] = None
    altegio_last_status_code: Optional[int] = None
    task_overrides: Dict[str, dict] = {}
    # Google Calendar integration
    google_calendar_event_id: Optional[str] = None
    cancellation_pending: bool = False
    cancellation_manager_confirmed: bool = False
    cancellation_requested_at: Optional[str] = None
    cancellation_confirmed_at: Optional[str] = None

class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = "global_settings"
    reminder_types: List[ReminderType] = []
    altegio_service_mappings: Dict[str, int] = Field(default_factory=lambda: dict(DEFAULT_ALTEGIO_SERVICE_MAPPINGS))

class TaskCompletionRequest(BaseModel):
    event_id: str
    reminder_id: str
    completed: bool

class SMMTaskCompletionRequest(BaseModel):
    event_id: str
    task_id: str
    completed: bool

class StandaloneTask(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    date: str
    icon: str = "coffee"
    type: str = "regular"  # "regular" or "smm"
    color: str = "standard"  # cosmetic color for icon
    assignee: str = "manager"  # "smm", "manager", "marketer" - determines column
    completed: bool = False
    completed_at: Optional[str] = None
    event_id: Optional[str] = ""  # optional link to existing event (metadata only)
    order: Optional[float] = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class DayOff(BaseModel):
    """A user-marked day off. When created, system suggests how to redistribute
    that person's tasks scheduled on that day to neighboring days."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    assignee: str  # "manager" | "smm" | "marketer"
    date: str  # YYYY-MM-DD
    note: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Post(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    date: str
    notes: str = ""
    post_type: str = "info"  # "info", "meme", "story"
    completed: bool = False
    completed_at: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class StandaloneTaskCreate(BaseModel):
    title: str
    date: str
    icon: str = "coffee"
    type: str = "regular"
    color: str = "standard"
    assignee: str = "manager"
    event_id: Optional[str] = ""  # optional link to an existing event
    order: Optional[float] = 0

class SMMTaskUpdate(BaseModel):
    name: Optional[str] = None
    days_before: Optional[int] = None
    color: Optional[str] = None  # "standard", "emerald", "red"
    is_text_work: Optional[bool] = None

class ParseEventRequest(BaseModel):
    text: str

class ParsedEvent(BaseModel):
    title: str
    date: str
    price: float = 0
    spots: int = 10
    description: str = ""
    start_time: str = ""
    end_time: str = ""
    confidence: float = 1.0
    missing_fields: List[str] = []

class ParseEventResponse(BaseModel):
    events: List[ParsedEvent]
    clarification_needed: bool = False
    clarification_message: str = ""

# ==================== SMM TASKS DEFINITION ====================

# Color options: "standard" (black), "emerald" (green), "red"
# ==================== TASK DEFINITIONS ====================

# ==================== FUTURE WORK PLACEHOLDERS ====================
#
# HOLIDAYS (заплановано):
#   - Список державних свят (1 січ, 8 бер, 1/9 трав, 24 серп, 14 жовт, 25 груд)
#     + популярні (14 лют, 7 січ, Великдень/Пасха, Купала, Хеллоуін, Новий рік).
#   - У день свята та за день перед ним — НЕ робимо анонсів.
#   - Анонс зміщується до або після (оптимізуємо по сумарній загрузці на день).
#
# DAY-OFFS (заплановано):
#   - Користувач вручну позначає вихідний для конкретної людини.
#   - Таски того дня автоматично перерозподіляються на сусідні дні
#     за вагою (weight) задачі — щоб збалансувати загрузку до/після вихідного.
#   - UI показує користувачу запропонований розподіл; він підтверджує або править.
#   - Таски зміщені більше ніж на 2 дні підсвічуються іншим кольором (попередження).
#
# Цей блок — лише орієнтир. Імплементація буде окремими фазами.
# ====================================================================

# Date correction helpers
def next_studio_day(dt):
    """Studio days: Mon(0), Tue(1), Thu(3), Fri(4). Skip Wed, Sat, Sun."""
    while dt.weekday() in (2, 5, 6):  # Wed, Sat, Sun
        dt += timedelta(days=1)
    return dt

def next_posting_day(dt):
    """Posting days: Mon-Thu, Sun. Skip Fri(4), Sat(5)."""
    while dt.weekday() in (4, 5):  # Fri, Sat
        dt += timedelta(days=1)
    return dt

def check_teamwork_conflict(dt, existing_teamwork_dates):
    """If teamwork date conflicts, shift to next studio day."""
    dt = next_studio_day(dt)
    attempts = 0
    while dt.isoformat()[:10] in existing_teamwork_dates and attempts < 14:
        dt += timedelta(days=1)
        dt = next_studio_day(dt)
        attempts += 1
    return dt

# MANAGEMENT event tasks (column: manager)
# series_master_only: True = task created ONLY for the master (first) instance
# of a recurring series; series children skip it. Used for one-off prep work
# that doesn't repeat per session (gathering info, designing announcement, etc.)
# Weight scale: 0.0..1.0, where 1.0 = повний 7-годинний робочий день.
# shift_kind:
#   "fixed" — не зсувається (день події/анонсу). При вихідному виконавця
#             система пропонує користувачу делегувати або скасувати.
#   "easy"  — вільно зсувається ±2 дні автоматично.
#   "chain" — частина ланцюжка залежностей (design → text → post тощо).
#             Зсув потребує перегляду іншими тасками — користувач підтверджує.
MANAGEMENT_TASKS = [
    {"id": "mgmt_info_master", "name": "попросити інфу від майстра", "days_before": 35, "condition": None, "series_master_only": True, "weight": 0.15, "shift_kind": "easy"},
    {"id": "mgmt_info_to_smm", "name": "інфу від майстра в smm", "days_before": 30, "condition": None, "series_master_only": True, "weight": 0.05, "shift_kind": "easy"},
    {"id": "mgmt_check_announce", "name": "перевірити чи все готово до анонсу", "days_before": 15, "condition": None, "series_master_only": True, "weight": 0.1, "shift_kind": "easy"},
    {"id": "mgmt_cancel_event", "name": "обговорити з маркетологом скасування", "days_before": 3, "condition": {"type": "booking_below", "threshold": 50}, "weight": 0.1, "shift_kind": "fixed"},
    {"id": "mgmt_remind_participants", "name": "нагадування учасникам", "days_before": 1, "condition": None, "weight": 0.1, "shift_kind": "fixed"},
    {"id": "mgmt_prepare_studio", "name": "підготовка студії", "days_before": 0, "condition": None, "weight": 0.3, "shift_kind": "fixed"},
    {"id": "mgmt_clean_studio", "name": "прибирання студії", "days_before": 0, "condition": None, "weight": 0.2, "shift_kind": "fixed"},
    {"id": "mgmt_expenses", "name": "внесення витрат і оплат", "days_before": 0, "condition": None, "weight": 0.05, "shift_kind": "fixed"},
    {"id": "mgmt_pay_master", "name": "оплата майстру", "days_before": 0, "condition": None, "series_master_only": True, "weight": 0.05, "shift_kind": "easy"},
    {"id": "mgmt_send_feedback", "name": "розіслати запрошення в чат і форму фідбеку", "days_before": -1, "condition": None, "regular_note": "регулярна → тільки новим", "weight": 0.1, "shift_kind": "fixed"},
    {"id": "mgmt_master_speech", "name": "попросити майстра зняти розмовне сторіс (зі студії або іншого місця)", "days_before": 10, "condition": {"type": "booking_below", "threshold": 60}, "series_master_only": True, "weight": 0.1, "shift_kind": "easy"},
    {"id": "mgmt_lucky_ticket", "name": "щасливий квиточок в групу", "days_before": 2, "condition": {"type": "booking_below", "threshold": 80}, "weight": 0.05, "shift_kind": "easy"},
]

# SMM event tasks (column: smm)
# Markers:
#   series_master_only: True       — only on series master, never on children
#   _series_only: "child"          — only on series children
#   _series_only: "non_child"      — only on one-off events + series master
SMM_TASKS = [
    # Pre-announce — chain dependency: design → text → post; series_master_only
    {"id": "smm_collect_materials", "name": "збір матеріалів та інфи для анонсу", "days_before": 30, "condition": None, "is_announcement": False, "series_master_only": True, "weight": 0.2, "shift_kind": "easy"},
    {"id": "smm_select_media", "name": "відбір фото-відео", "days_before": 30, "condition": None, "is_announcement": False, "series_master_only": True, "weight": 0.3, "shift_kind": "easy"},
    {"id": "smm_design_announce", "name": "монтаж/дизайн анонсу", "days_before": 25, "condition": None, "is_announcement": False, "series_master_only": True, "weight": 0.4, "shift_kind": "chain"},
    {"id": "smm_text_announce", "name": "текст для анонсу", "days_before": 19, "condition": None, "is_announcement": False, "series_master_only": True, "weight": 0.3, "shift_kind": "chain"},
    {"id": "smm_video_feedbacks", "name": "шукати і монтувати емоційні моменти і фідбеки", "days_before": 18, "condition": {"type": "booking_below", "threshold": 70}, "is_announcement": False, "_skip_for_one_off": True, "series_master_only": True, "weight": 0.5, "shift_kind": "easy"},
    {"id": "smm_storytelling_prep", "name": "підготовка сторітеллінгу", "days_before": 18, "condition": None, "is_announcement": False, "series_master_only": True, "weight": 0.2, "shift_kind": "easy"},
    # Announce day (-14) — все на постинговий день, fixed
    {"id": "smm_post_announce", "name": "пост анонсу", "days_before": 14, "condition": None, "is_announcement": True, "series_master_only": True, "weight": 0.2, "shift_kind": "fixed"},
    {"id": "smm_share_tg", "name": "шер анонсу в тг", "days_before": 14, "condition": None, "is_announcement": True, "series_master_only": True, "weight": 0.1, "shift_kind": "fixed"},
    {"id": "smm_storytelling", "name": "сторітеллінг", "days_before": 14, "condition": None, "is_announcement": True, "weight": 0.15, "shift_kind": "fixed"},
    {"id": "smm_threads_warmup", "name": "прогрів теми в threads", "days_before": 14, "condition": None, "is_announcement": True, "series_master_only": True, "weight": 0.15, "shift_kind": "fixed"},
    # Extra contingency for a SERIES CHILD
    {"id": "smm_extra_storytelling", "name": "додатковий сторітеллінг", "days_before": 14, "condition": {"type": "booking_below", "threshold": 80}, "is_announcement": True, "_series_only": "child", "weight": 0.15, "shift_kind": "fixed"},
    {"id": "smm_extra_reel", "name": "новий рілс на тему події", "days_before": 14, "condition": {"type": "booking_below", "threshold": 70}, "is_announcement": False, "_series_only": "child", "weight": 0.5, "shift_kind": "easy"},
    # Conditional comm/content as event approaches
    {"id": "smm_past_events_50", "name": "сторіс з минулих подій і фідбеки", "days_before": 10, "condition": {"type": "booking_below", "threshold": 50}, "is_announcement": False, "weight": 0.2, "shift_kind": "easy"},
    {"id": "smm_master_story", "name": "розмовний сторіс майстра", "days_before": 8, "condition": {"type": "booking_below", "threshold": 60}, "is_announcement": False, "weight": 0.05, "shift_kind": "easy"},
    {"id": "smm_storytelling_60", "name": "сторітеллінг", "days_before": 7, "condition": {"type": "booking_below", "threshold": 60}, "is_announcement": False, "weight": 0.15, "shift_kind": "easy"},
    {"id": "smm_past_events_80", "name": "сторіс з минулих подій і фідбеки", "days_before": 5, "condition": {"type": "booking_below", "threshold": 80}, "is_announcement": False, "weight": 0.2, "shift_kind": "easy"},
    {"id": "smm_remind_story", "name": "нагадування в сторіс", "days_before": 1, "condition": {"type": "booking_below", "threshold": 90}, "is_announcement": False, "weight": 0.1, "shift_kind": "fixed"},
    # Day-of content
    {"id": "smm_shoot_content", "name": "знімати контент", "days_before": 0, "condition": None, "is_announcement": False, "_series_only": "non_child", "weight": 0.2, "shift_kind": "fixed"},
    {"id": "smm_shoot_content_child", "name": "знімати контент", "days_before": 0, "condition": {"type": "booking_below", "threshold": 70}, "is_announcement": False, "_series_only": "child", "weight": 0.2, "shift_kind": "fixed"},
    {"id": "smm_post_stories", "name": "постити сторі відразу з події", "days_before": 0, "condition": None, "is_announcement": False, "_series_only": "non_child", "weight": 0.15, "shift_kind": "fixed"},
    {"id": "smm_post_stories_child", "name": "постити сторі відразу з події", "days_before": 0, "condition": {"type": "booking_below", "threshold": 70}, "is_announcement": False, "_series_only": "child", "weight": 0.15, "shift_kind": "fixed"},
    {"id": "smm_upload_google", "name": "оптимізувати фото-відео, видалити невдалі і залити на google photo", "days_before": -1, "condition": None, "is_announcement": False, "weight": 0.2, "shift_kind": "easy"},
]

MARKETING_TASKS = [
    {"id": "mktg_check_announce", "name": "перевірити все перед анонсом", "days_before": 15, "condition": None, "series_master_only": True, "weight": 0.1, "shift_kind": "easy"},
    {"id": "mktg_start_targeting", "name": "запуск таргетингу", "days_before": 12, "condition": {"type": "booking_below", "threshold": 40}, "weight": 0.4, "shift_kind": "easy"},
    {"id": "mktg_update_target_50", "name": "апдейт таргетингу", "days_before": 10, "condition": {"type": "booking_below", "threshold": 50}, "weight": 0.2, "shift_kind": "easy"},
    {"id": "mktg_update_target_60", "name": "апдейт таргетингу", "days_before": 8, "condition": {"type": "booking_below", "threshold": 60}, "weight": 0.2, "shift_kind": "easy"},
    {"id": "mktg_stop_targeting", "name": "зупинити таргетинг", "days_before": 7, "condition": {"type": "booking_above", "threshold": 80}, "weight": 0.1, "shift_kind": "fixed"},
    {"id": "mktg_update_target_80", "name": "апдейт таргетингу", "days_before": 5, "condition": {"type": "booking_below", "threshold": 80}, "weight": 0.2, "shift_kind": "easy"},
    {"id": "mktg_personal_invites", "name": "особисті запрошення", "days_before": 5, "condition": {"type": "booking_below", "threshold": 70}, "weight": 0.4, "shift_kind": "easy"},
]

# MONTHLY AUTO-TASKS (generated relative to 1st of each month)
MONTHLY_TASKS = [
    # Тімворки
    {"id": "monthly_plan_teamwork", "name": "план подій тімворк", "days_before": 50, "column": "management", "is_teamwork": True, "calendar_event": {"title_template": "план подій на {month}", "start_time": "14:00", "end_time": "15:00"}},
    {"id": "monthly_content_plan_tw", "name": "контент-план тімворк", "days_before": 40, "column": "smm", "is_teamwork": True, "calendar_event": {"title_template": "контент-план на {month}", "start_time": "14:00", "end_time": "16:00"}},
    {"id": "monthly_mktg_plan_tw", "name": "план подій тімворк", "days_before": 50, "column": "marketing", "is_teamwork": True},
    {"id": "monthly_mktg_content_tw", "name": "контент-план тімворк", "days_before": 40, "column": "marketing", "is_teamwork": True},
    # Manager
    {"id": "monthly_mgmt_check_mktg", "name": "перевірити маркетинг план", "days_before": 39, "column": "management"},
    {"id": "monthly_mgmt_next_month_info", "name": "підготувати інфу для посту «Події наступного місяця»", "days_before": 38, "column": "management"},
    # Marketer
    {"id": "monthly_influencers", "name": "вибрати 10 інфлюенсерів", "days_before": 40, "column": "marketing"},
    {"id": "monthly_ambassadors", "name": "написати амбасадорам", "days_before": 27, "column": "marketing"},
    {"id": "monthly_mktg_info_posts", "name": "обговорення інфо-постів", "days_before": 40, "column": "marketing"},
    {"id": "monthly_mktg_discuss_memes", "name": "обговорити ідеї мемів", "days_before": 7, "column": "marketing"},
    {"id": "monthly_approve_memes", "name": "затвердити меми", "days_before": 3, "column": "marketing", "calendar_event": {"title_template": "затвердити меми", "start_time": "17:00", "end_time": "18:00"}},
    # SMM
    {"id": "monthly_smm_info_posts", "name": "обговорення інфо-постів", "days_before": 40, "column": "smm"},
    {"id": "monthly_smm_next_month_post", "name": "зробити пост «Події наступного місяця»", "days_before": 35, "column": "smm"},
    {"id": "monthly_smm_next_month_publish", "name": "опублікувати пост «Події наступного місяця»", "days_before": 27, "column": "smm"},
    {"id": "monthly_smm_influencers", "name": "написати інфлюенсерам", "days_before": 27, "column": "smm"},
    {"id": "monthly_smm_next_month_remind_14", "name": "нагадування про «Події наступного місяця»", "days_before": 14, "column": "smm"},
    {"id": "monthly_smm_meme_ideas", "name": "ідеї для мемів", "days_before": 10, "column": "smm"},
    {"id": "monthly_smm_discuss_memes", "name": "обговорити ідеї мемів", "days_before": 7, "column": "smm"},
    {"id": "monthly_smm_calendar_memes", "name": "внести в календар меми", "days_before": 7, "column": "smm"},
    {"id": "monthly_smm_next_month_remind_7", "name": "нагадування про «Події наступного місяця»", "days_before": 7, "column": "smm"},
    {"id": "monthly_smm_make_meme_5", "name": "робота над мемами", "days_before": 5, "column": "smm"},
    {"id": "monthly_smm_make_meme_3", "name": "робота над мемами", "days_before": 3, "column": "smm"},
    {"id": "monthly_smm_next_month_remind_0", "name": "нагадування про «Події наступного місяця»", "days_before": 0, "column": "smm"},
]

# DAILY TASKS
DAILY_TASKS = [
    {"id": "daily_direct", "name": "дірект", "column": "management"},
    {"id": "daily_threads", "name": "двіж в threads", "column": "smm"},
]

UK_MONTHS_NOMINATIVE_PY = {
    1: "січень", 2: "лютий", 3: "березень", 4: "квітень",
    5: "травень", 6: "червень", 7: "липень", 8: "серпень",
    9: "вересень", 10: "жовтень", 11: "листопад", 12: "грудень",
}

# ==================== TASK DEFINITION OVERRIDES ====================
#
# User can edit / delete / add task definitions via Settings UI. We don't mutate
# the hardcoded lists above. Instead all manual changes live in the
# `task_definition_overrides` MongoDB collection, structured as DIFFs against
# the hardcoded defaults. This means:
#   • Every manual change is recorded — trivially read with
#     db.task_definition_overrides.find()
#   • Each override carries a `history` list of previous patches → easy revert
#   • Brand-new tasks (no hardcoded counterpart) live in the same collection
#     with is_new=True + full_definition
#
# The cache `_task_overrides` is kept in-memory and refreshed after each write
# so that get_tasks_for_column() stays synchronous.

_task_overrides: Dict[str, dict] = {}  # task_id -> override doc

async def _refresh_task_overrides_cache():
    global _task_overrides
    docs = await db.task_definition_overrides.find({}, {"_id": 0}).to_list(2000)
    _task_overrides = {d["task_id"]: d for d in docs if d.get("task_id")}

def _apply_overrides_to_list(target: str, base_list: list) -> list:
    """Merge base hardcoded tasks with per-task overrides + brand-new tasks.

    target = "management" | "smm" | "marketing" → event tasks for that assignee
             "monthly"  → monthly tasks (all assignees in one bucket)
             "daily"    → daily tasks
    """
    result = []
    seen_ids = set()
    for t in base_list:
        ov = _task_overrides.get(t["id"])
        if ov:
            if ov.get("is_deleted"):
                continue
            patch = ov.get("patch") or {}
            t = {**t, **patch}
        result.append(t)
        seen_ids.add(t["id"])
    # Brand-new tasks created via "+ новий таск"
    for tid, ov in _task_overrides.items():
        if tid in seen_ids:
            continue
        if not ov.get("is_new"):
            continue
        full = ov.get("full_definition") or {}
        freq = full.get("frequency", "event")
        col = full.get("column")
        if target in ("management", "smm", "marketing"):
            if freq == "event" and col == target:
                result.append({**full, "id": tid})
        elif target == "monthly" and freq == "monthly":
            result.append({**full, "id": tid})
        elif target == "daily" and freq == "daily":
            result.append({**full, "id": tid})
    return result

def get_tasks_for_column(column: str) -> list:
    """Get full task list for a column = hardcoded defaults + applied overrides."""
    if column == "management":
        return _apply_overrides_to_list(column, MANAGEMENT_TASKS)
    if column == "smm":
        return _apply_overrides_to_list(column, SMM_TASKS)
    if column == "marketing":
        return _apply_overrides_to_list(column, MARKETING_TASKS)
    if column == "monthly":
        return _apply_overrides_to_list(column, MONTHLY_TASKS)
    return []

def calculate_event_tasks(event_date_str, column, is_series_child: bool = False, is_series: bool = False):
    """Calculate task dates for a specific column based on event date.

    Markers honoured:
      series_master_only:  skip for series children (kept on master only)
      _series_only="child":     only for series children
      _series_only="non_child": only for one-off + series master (skip children)
      _skip_for_one_off:   skip for one-off events (one-off = NOT part of series)
    """
    try:
        event_dt = datetime.fromisoformat(event_date_str.replace('Z', '+00:00'))
    except:
        event_dt = datetime.strptime(event_date_str[:10], '%Y-%m-%d')

    tasks = get_tasks_for_column(column)
    result = {}
    for task in tasks:
        if is_series_child and task.get("series_master_only"):
            continue
        series_only = task.get("_series_only")
        if series_only == "child" and not is_series_child:
            continue
        if series_only == "non_child" and is_series_child:
            continue
        if task.get("_skip_for_one_off") and not is_series:
            continue
        task_date = event_dt - timedelta(days=task["days_before"])
        # Apply date corrections
        if task.get("is_teamwork"):
            task_date = next_studio_day(task_date)
        if task.get("is_announcement"):
            task_date = next_posting_day(task_date)
        result[task["id"]] = task_date.isoformat()[:10]
    return result

def calculate_monthly_tasks(year, month):
    """Calculate monthly auto-task dates for a given month."""
    first_of_month = datetime(year, month, 1)
    result = {}
    for task in MONTHLY_TASKS:
        task_date = first_of_month - timedelta(days=task["days_before"])
        if task.get("is_teamwork"):
            task_date = next_studio_day(task_date)
        result[task["id"]] = {
            "date": task_date.isoformat()[:10],
            "name": task["name"],
            "column": task["column"],
            "calendar_event": task.get("calendar_event"),
        }
    return result

# ==================== DAILY QUOTES ====================

DAILY_QUOTES = [
    "усвідомленість — це коли ти пам'ятаєш, що забув щось важливе",
    "медитуй, поки не зрозумієш, що дедлайн вже завтра",
    "будь тут і зараз. особливо якщо тут — це робота",
    "вдихни спокій, видихни паніку перед івентом",
    "твоє тіло — храм. а храм треба прибирати перед гостями",
    "живи моментом. цей момент коштує 1400 грн",
    "все тимчасове. крім твоїх завдань у таск-менеджері",
    "відпусти контроль. але не над бюджетом івенту",
    "кожен день — новий початок. і новий дедлайн",
    "прийми себе таким, який ти є. з усіма цими завданнями",
    "щастя — це шлях. бажано з навігатором до локації",
    "будь вдячний за те, що маєш. особливо за wi-fi",
    "сьогодні — подарунок. тому й зветься present",
    "дихай глибше. кисень безкоштовний, на відміну від кави",
    "ти — не твої думки. ти — твій гугл-календар",
]

def get_daily_quote():
    today = datetime.now(timezone.utc).date()
    day_of_year = today.timetuple().tm_yday
    quote_index = day_of_year % len(DAILY_QUOTES)
    return DAILY_QUOTES[quote_index]

# ==================== HELPERS ====================

async def get_settings() -> Settings:
    settings_doc = await db.settings.find_one({"id": "global_settings"}, {"_id": 0})
    if settings_doc:
        merged_mappings = {
            **DEFAULT_ALTEGIO_SERVICE_MAPPINGS,
            **(settings_doc.get("altegio_service_mappings") or {}),
        }
        settings_doc["altegio_service_mappings"] = merged_mappings
        return Settings(**settings_doc)
    # Default reminders from actual usage
    default_reminders = [
        ReminderType(id="check_info", name="перевірити чи є вся інфа", days_before=24, icon="circle"),
        ReminderType(id="check_ready_announce", name="перевірити чи все готово до анонсу", days_before=16, icon="circle"),
        ReminderType(id="publish_announce", name="публікація анонсу", days_before=14, icon="bell"),
        ReminderType(id="check_participants_10", name="перевірити кількість учасників", days_before=10, icon="sparkles"),
        ReminderType(id="check_participants_4", name="перевірити кількість учасників", days_before=4, icon="sparkles"),
        ReminderType(id="remind_participants", name="нагадування учасникам", days_before=1, icon="bell"),
        ReminderType(id="prepare_studio", name="підготовка студії", days_before=0, icon="circle"),
        ReminderType(id="pay_master", name="оплата майстру", days_before=0, icon="circle"),
        ReminderType(id="send_feedback", name="розіслати запрошення в чат і форму фідбеку", days_before=0, icon="send"),
    ]
    default_settings = Settings(reminder_types=default_reminders)
    await db.settings.insert_one(default_settings.model_dump())
    return default_settings

def calculate_reminder_dates(event_date: str, reminder_types: List[ReminderType], is_series_child: bool = False, is_series: bool = False) -> Dict[str, str]:
    """Calculate management task dates - now uses MANAGEMENT_TASKS"""
    return calculate_event_tasks(event_date, "management", is_series_child=is_series_child, is_series=is_series)

def calculate_marketing_dates(event_date: str, is_series_child: bool = False, is_series: bool = False) -> Dict[str, str]:
    """Calculate marketing task dates"""
    return calculate_event_tasks(event_date, "marketing", is_series_child=is_series_child, is_series=is_series)

def adjust_for_weekend(date: datetime, is_posting: bool) -> datetime:
    """
    If is_posting task falls on Friday -> move to Thursday
    If is_posting task falls on Saturday -> move to Sunday
    """
    if not is_posting:
        return date
    weekday = date.weekday()
    if weekday == 4:   # Friday -> Thursday
        return date - timedelta(days=1)
    elif weekday == 5:  # Saturday -> Sunday
        return date + timedelta(days=1)
    return date

def calculate_smm_dates(event_date: str, is_series_child: bool = False, is_series: bool = False) -> Dict[str, str]:
    """Calculate SMM task dates based on event date with date corrections"""
    return calculate_event_tasks(event_date, "smm", is_series_child=is_series_child, is_series=is_series)


# ==================== TELEGRAM HELPERS ====================

def _telegram_tz():
    try:
        return ZoneInfo(TELEGRAM_TIMEZONE)
    except Exception:
        return ZoneInfo("Europe/Kyiv")


def _today_kyiv() -> str:
    return datetime.now(_telegram_tz()).date().isoformat()


def _html_escape(value: object) -> str:
    return html.escape(str(value or ""), quote=False)


def _poriadok_link() -> str:
    return f'<a href="{_html_escape(PORIADOK_APP_URL)}">відкрити Poriadok</a>'


def _format_task_date(date_str: str) -> str:
    if not date_str:
        return "без дати"
    try:
        d = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
        today = datetime.now(_telegram_tz()).date()
        if d == today:
            return "сьогодні"
        if d == today + timedelta(days=1):
            return "завтра"
        return d.strftime("%d.%m")
    except Exception:
        return date_str[:10]


async def _ensure_user_setting(user_id: str) -> dict:
    user_id = normalize_assignee(user_id, "")
    if user_id not in TEAM_USERS:
        raise HTTPException(status_code=404, detail="User not found")
    defaults = {
        "user_id": user_id,
        "telegram_chat_id": None,
        "telegram_username": "",
        "link_code": None,
        "muted": False,
        "link_expires_at": None,
    }
    await db.user_settings.update_one(
        {"user_id": user_id},
        {"$setOnInsert": defaults},
        upsert=True,
    )
    doc = await db.user_settings.find_one({"user_id": user_id}, {"_id": 0})
    return doc or defaults


async def _find_user_by_chat(chat_id: int) -> Optional[dict]:
    doc = await db.user_settings.find_one({"telegram_chat_id": chat_id}, {"_id": 0})
    if doc and doc.get("user_id"):
        doc["user_id"] = normalize_assignee(doc["user_id"])
    return doc


async def _telegram_status_payload(user_id: str) -> dict:
    user_id = normalize_assignee(user_id, "")
    doc = await _ensure_user_setting(user_id)
    linked = bool(doc.get("telegram_chat_id"))
    expires_at = doc.get("link_expires_at")
    if isinstance(expires_at, datetime):
        expires_at = expires_at.isoformat()
    return {
        "user_id": user_id,
        "linked": linked,
        "muted": bool(doc.get("muted")),
        "telegram_username": doc.get("telegram_username") or "",
        "telegram_chat_id": doc.get("telegram_chat_id"),
        "link_expires_at": expires_at,
        "bot_username": TELEGRAM_BOT_USERNAME,
        "enabled": bool(TELEGRAM_BOT_TOKEN),
    }


async def _telegram_send_setting(user_id: str) -> Optional[dict]:
    user_id = normalize_assignee(user_id, "")
    aliases = assignee_storage_aliases(user_id)
    docs = await db.user_settings.find({"user_id": {"$in": aliases}}, {"_id": 0}).to_list(len(aliases))
    exact = next((doc for doc in docs if normalize_assignee(doc.get("user_id"), "") == user_id and doc.get("user_id") == user_id), None)
    if exact and exact.get("telegram_chat_id"):
        return exact
    linked_alias = next((doc for doc in docs if doc.get("telegram_chat_id")), None)
    return linked_alias or exact or (docs[0] if docs else None)


def _task_def_for_event_task(column: str, task_id: str) -> dict:
    return next((t for t in get_tasks_for_column(column) if t.get("id") == task_id), {})


def _event_task_owner(column: str, override: dict) -> str:
    owner_by_column = {
        "management": "manager",
        "smm": "smm",
        "marketing": "marketer",
    }
    return normalize_assignee(override.get("assignee") or owner_by_column.get(column, "manager"))


async def _collect_user_tasks(user_id: str, *, target_date: Optional[str] = None, overdue: bool = False) -> List[dict]:
    user_id = normalize_assignee(user_id, "")
    column = ASSIGNEE_TO_COLUMN.get(user_id)
    if not column:
        return []

    today = _today_kyiv()
    tasks: List[dict] = []

    standalone_filter = {"assignee": {"$in": assignee_storage_aliases(user_id)}, "completed": {"$ne": True}}
    standalone = await db.standalone_tasks.find(standalone_filter, {"_id": 0}).to_list(2000)
    for task in standalone:
        task_date = (task.get("date") or "")[:10]
        if target_date and task_date != target_date:
            continue
        if overdue and (not task_date or task_date >= today):
            continue
        tasks.append({
            "title": task.get("title") or "таск",
            "date": task_date,
            "source": "standalone",
            "event_title": "",
        })

    event_query = {"cancelled": {"$ne": True}, "archived": {"$ne": True}}
    events = await db.events.find(event_query, {"_id": 0}).to_list(3000)
    field = COLUMN_TO_FIELD[column]
    completed_field = COLUMN_TO_COMPLETED_FIELD[column]
    for event in events:
        event_tasks = event.get(field, {}) or {}
        completed = event.get(completed_field, {}) or {}
        overrides = event.get("task_overrides", {}) or {}
        for task_id, task_date in event_tasks.items():
            task_date = (task_date or "")[:10]
            if not task_date or completed.get(task_id):
                continue
            override = overrides.get(task_id, {}) or {}
            if _event_task_owner(column, override) != user_id:
                continue
            if target_date and task_date != target_date:
                continue
            if overdue and task_date >= today:
                continue
            definition = _task_def_for_event_task(column, task_id)
            tasks.append({
                "title": override.get("title") or definition.get("name") or task_id,
                "date": task_date,
                "source": "event",
                "event_title": event.get("title", ""),
                "event_id": event.get("id", ""),
            })

    tasks.sort(key=lambda item: (item.get("date") or "9999-99-99", item.get("title") or ""))
    return tasks


def _format_task_list(tasks: List[dict], empty_text: str) -> str:
    if not tasks:
        return empty_text
    lines = []
    for idx, task in enumerate(tasks[:12], start=1):
        event_part = f" · {_html_escape(task.get('event_title'))}" if task.get("event_title") else ""
        lines.append(f"{idx}. {_html_escape(task.get('title'))} — {_format_task_date(task.get('date', ''))}{event_part}")
    if len(tasks) > 12:
        lines.append(f"ще {len(tasks) - 12}...")
    return "\n".join(lines)


async def send_telegram(user_id: str, text: str) -> bool:
    user_id = normalize_assignee(user_id, "")
    if not telegram_app:
        return False
    doc = await _telegram_send_setting(user_id)
    if not doc or not doc.get("telegram_chat_id") or doc.get("muted"):
        return False
    try:
        await telegram_app.bot.send_message(
            chat_id=doc["telegram_chat_id"],
            text=text,
            parse_mode="HTML",
            disable_web_page_preview=True,
        )
        return True
    except Exception as e:
        logging.error(f"Telegram send error for {user_id}: {e}")
        return False


def enqueue_telegram(user_id: str, text: str) -> None:
    if telegram_app:
        asyncio.create_task(send_telegram(user_id, text))


def _actor_from_request(request: Request) -> str:
    actor = (request.headers.get("X-Actor-User") or "").strip().lower()
    actor = normalize_assignee(actor, "")
    return actor if actor in TEAM_USERS else ""


def _event_line(event: dict) -> str:
    time_part = f" {event.get('start_time')}" if event.get("start_time") else ""
    return f"<b>{_html_escape(event.get('title'))}</b> {_format_task_date(event.get('date', ''))}{_html_escape(time_part)}"


def _event_paid_count(event: Optional[dict]) -> int:
    if not event:
        return 0
    for key in ("paid_count", "payments_count", "altegio_paid_count", "altegio_booked_count"):
        try:
            value = event.get(key)
            if value is not None:
                return max(0, int(value))
        except Exception:
            continue
    return 0


async def _refresh_event_payment_snapshot(event: dict) -> dict:
    """Best-effort refresh of Altegio booking count before destructive actions."""
    if not event:
        return event
    altegio_id = event.get("altegio_id") or event.get("altegio_activity_id")
    if not altegio_id:
        return event

    booked_count = None
    try:
        bookings = await altegio_client.get_activity_bookings(str(altegio_id))
        if bookings is not None:
            booked_count = len(bookings)
        else:
            altegio_events = await altegio_client.get_group_events()
            for altegio_event in altegio_events:
                if str(altegio_event.get("id")) == str(altegio_id):
                    booked_count = _altegio_booked_count(altegio_event)
                    break
    except Exception as e:
        logging.error(f"Failed to refresh Altegio booking count for event {event.get('id')}: {e}")

    if booked_count is None:
        return event

    event = {**event, "altegio_booked_count": max(0, int(booked_count))}
    await db.events.update_one(
        {"id": event.get("id")},
        {"$set": {
            "altegio_booked_count": event["altegio_booked_count"],
            "altegio_last_sync": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return event


def _event_cancellation_confirmed(event_data: dict, request: Request) -> bool:
    return bool(
        event_data.get("manager_confirmed_cancellation")
        or event_data.get("force")
        or request.query_params.get("manager_confirmed_cancellation") == "true"
    )


def _cancellation_guard_detail(event: dict, action: str) -> dict:
    paid_count = _event_paid_count(event)
    title = event.get("title") or "подія"
    return {
        "code": "manager_confirmation_required",
        "action": action,
        "event_id": event.get("id"),
        "paid_count": paid_count,
        "message": f"У події «{title}» є {paid_count} реєстрацій/оплат. Спершу менеджер має узгодити з учасниками; я створив таски.",
    }


def _notify_team(actor: str, text: str) -> None:
    if not actor:
        return
    for user_id in TEAM_USERS:
        if user_id != actor:
            enqueue_telegram(user_id, text)


def _notify_assignee(actor: str, assignee: str, text: str) -> None:
    assignee = normalize_assignee(assignee, "")
    if actor and assignee in TEAM_USERS and assignee != actor:
        enqueue_telegram(assignee, text)


async def _today_events_summary() -> str:
    today = _today_kyiv()
    events = await db.events.find(
        {"date": {"$regex": f"^{today}"}, "cancelled": {"$ne": True}, "archived": {"$ne": True}},
        {"_id": 0, "title": 1, "start_time": 1},
    ).to_list(20)
    if not events:
        return ""
    events.sort(key=lambda e: e.get("start_time") or "99:99")
    first = events[0]
    time_part = f" {first.get('start_time')}" if first.get("start_time") else ""
    extra = f" (+{len(events) - 1})" if len(events) > 1 else ""
    return f"подія сьогодні: <b>{_html_escape(first.get('title'))}</b>{_html_escape(time_part)}{extra}"


async def _build_today_tasks_message(user_id: str) -> str:
    user_id = normalize_assignee(user_id, "")
    today_tasks = await _collect_user_tasks(user_id, target_date=_today_kyiv())
    event_line = await _today_events_summary()
    lines = [
        f"📋 сьогодні для {_html_escape(TEAM_USER_LABELS.get(user_id, user_id))}:",
        _format_task_list(today_tasks, "тасків на сьогодні немає"),
    ]
    if event_line:
        lines.extend(["", event_line])
    lines.extend(["", _poriadok_link()])
    return "\n".join(lines)


async def _build_morning_summary(user_id: str) -> str:
    today_tasks = await _collect_user_tasks(user_id, target_date=_today_kyiv())
    overdue_tasks = await _collect_user_tasks(user_id, overdue=True)
    event_line = await _today_events_summary()
    lines = [
        f"📋 доброго ранку, {_html_escape(TEAM_USER_LABELS.get(user_id, user_id))}.",
        f"сьогодні в тебе: <b>{len(today_tasks)}</b> тасків ({len(overdue_tasks)} протерм).",
        "",
        "сьогодні:",
        _format_task_list(today_tasks, "тасків на сьогодні немає"),
    ]
    if overdue_tasks:
        lines.extend(["", "протерміновано:", _format_task_list(overdue_tasks, "")])
    if event_line:
        lines.extend(["", event_line])
    lines.append("")
    lines.append(_poriadok_link())
    return "\n".join(lines)


async def _send_morning_summaries() -> dict:
    sent = 0
    skipped = 0
    for user_id in TEAM_USERS:
        message = await _build_morning_summary(user_id)
        if await send_telegram(user_id, message):
            sent += 1
        else:
            skipped += 1
    return {"sent": sent, "skipped": skipped}


async def telegram_summary_loop():
    if not TELEGRAM_BOT_TOKEN:
        return
    while True:
        try:
            now = datetime.now(_telegram_tz())
            target = now.replace(hour=9, minute=0, second=0, microsecond=0)
            if target <= now:
                target = target + timedelta(days=1)
            await asyncio.sleep(max(1, (target - now).total_seconds()))
            result = await _send_morning_summaries()
            logging.info(f"Telegram morning summary completed: {result}")
        except asyncio.CancelledError:
            logging.info("Telegram summary task cancelled")
            break
        except Exception as e:
            logging.error(f"Telegram summary error: {e}")
            await asyncio.sleep(60)


def _telegram_main_keyboard():
    if not ReplyKeyboardMarkup:
        return None
    return ReplyKeyboardMarkup(
        [
            ["/today", "/overdue"],
            ["/mute", "/unmute"],
        ],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="/link код",
    )


async def telegram_start_command(update, context):
    await update.message.reply_text(
        "привіт. кнопки нижче, а для привʼязки надішли /link 123456",
        reply_markup=_telegram_main_keyboard(),
    )


async def telegram_link_command(update, context):
    args = context.args or []
    if not args:
        await update.message.reply_text("надішли код так: /link 123456", reply_markup=_telegram_main_keyboard())
        return

    code = args[0].strip()
    now = datetime.now(timezone.utc)
    doc = await db.user_settings.find_one({
        "link_code": code,
        "link_expires_at": {"$gt": now},
    }, {"_id": 0})
    if not doc:
        await update.message.reply_text("код не знайдено або він вже протермінований", reply_markup=_telegram_main_keyboard())
        return

    chat = update.effective_chat
    username = update.effective_user.username if update.effective_user else ""
    await db.user_settings.update_many(
        {"telegram_chat_id": chat.id},
        {"$set": {"telegram_chat_id": None, "telegram_username": ""}},
    )
    await db.user_settings.update_one(
        {"user_id": normalize_assignee(doc["user_id"])},
        {"$set": {
            "telegram_chat_id": chat.id,
            "telegram_username": username or "",
            "muted": False,
            "link_code": None,
            "link_expires_at": None,
        }},
    )
    await update.message.reply_text(f"✓ привʼязано до акаунту {doc['user_id']}", reply_markup=_telegram_main_keyboard())


async def telegram_today_command(update, context):
    user = await _find_user_by_chat(update.effective_chat.id)
    if not user:
        await update.message.reply_text("спершу привʼяжи акаунт через /link 123456", reply_markup=_telegram_main_keyboard())
        return
    await update.message.reply_html(await _build_today_tasks_message(user["user_id"]))


async def telegram_overdue_command(update, context):
    user = await _find_user_by_chat(update.effective_chat.id)
    if not user:
        await update.message.reply_text("спершу привʼяжи акаунт через /link 123456", reply_markup=_telegram_main_keyboard())
        return
    tasks = await _collect_user_tasks(user["user_id"], overdue=True)
    await update.message.reply_html(f"📋 протерміновано:\n{_format_task_list(tasks, 'протермінованих тасків немає')}\n\n{_poriadok_link()}")


async def telegram_mute_command(update, context):
    user = await _find_user_by_chat(update.effective_chat.id)
    if not user:
        await update.message.reply_text("спершу привʼяжи акаунт через /link 123456", reply_markup=_telegram_main_keyboard())
        return
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"muted": True}})
    await update.message.reply_text("ок, сповіщення тимчасово вимкнено", reply_markup=_telegram_main_keyboard())


async def telegram_unmute_command(update, context):
    user = await _find_user_by_chat(update.effective_chat.id)
    if not user:
        await update.message.reply_text("спершу привʼяжи акаунт через /link 123456", reply_markup=_telegram_main_keyboard())
        return
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"muted": False}})
    await update.message.reply_text("ок, сповіщення знову увімкнено", reply_markup=_telegram_main_keyboard())


@api_router.get("/users/{user_id}/telegram/status")
async def get_telegram_status(user_id: str):
    return await _telegram_status_payload(user_id)


@api_router.post("/users/{user_id}/telegram/link-code")
async def create_telegram_link_code(user_id: str):
    user_id = normalize_assignee(user_id, "")
    await _ensure_user_setting(user_id)
    code = f"{random.randint(0, 999999):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    await db.user_settings.update_one(
        {"user_id": user_id},
        {"$set": {
            "link_code": code,
            "link_expires_at": expires_at,
        }},
        upsert=True,
    )
    return {
        "code": code,
        "expires_at": expires_at.isoformat(),
        "bot_username": TELEGRAM_BOT_USERNAME,
    }


@api_router.post("/users/{user_id}/telegram/mute")
async def mute_telegram_user(user_id: str):
    user_id = normalize_assignee(user_id, "")
    await _ensure_user_setting(user_id)
    await db.user_settings.update_one({"user_id": user_id}, {"$set": {"muted": True}})
    return await _telegram_status_payload(user_id)


@api_router.post("/users/{user_id}/telegram/unmute")
async def unmute_telegram_user(user_id: str):
    user_id = normalize_assignee(user_id, "")
    await _ensure_user_setting(user_id)
    await db.user_settings.update_one({"user_id": user_id}, {"$set": {"muted": False}})
    return await _telegram_status_payload(user_id)


@api_router.post("/users/{user_id}/telegram/unlink")
async def unlink_telegram_user(user_id: str):
    user_id = normalize_assignee(user_id, "")
    await _ensure_user_setting(user_id)
    await db.user_settings.update_many(
        {"user_id": {"$in": assignee_storage_aliases(user_id)}},
        {"$set": {
            "telegram_chat_id": None,
            "telegram_username": "",
            "link_code": None,
            "link_expires_at": None,
            "muted": False,
        }},
    )
    return await _telegram_status_payload(user_id)


@api_router.post("/admin/telegram/test-summary")
async def test_telegram_summary():
    return await _send_morning_summaries()


@api_router.post("/admin/telegram/test-today")
async def test_telegram_today(user_id: Optional[str] = None):
    users = [normalize_assignee(user_id, "")] if user_id else list(TEAM_USERS)
    sent = 0
    skipped = 0
    for uid in users:
        if uid not in TEAM_USERS:
            skipped += 1
            continue
        if await send_telegram(uid, await _build_today_tasks_message(uid)):
            sent += 1
        else:
            skipped += 1
    return {"sent": sent, "skipped": skipped}


# ==================== EVENTS API ====================

@api_router.get("/")
async def root():
    return {"message": "sensa API"}

@api_router.get("/quote")
async def get_quote():
    return {"quote": get_daily_quote()}

# --- Altegio service auto-matching (server-side; cache to avoid hammering API) ---
_altegio_services_cache: Dict[str, object] = {"data": [], "fetched_at": 0.0}

async def _get_altegio_services_cached(ttl_seconds: float = 600.0) -> list:
    """Return Altegio service catalogue with simple TTL cache (10 min default)."""
    import time
    now = time.time()
    if (now - float(_altegio_services_cache["fetched_at"])) < ttl_seconds and _altegio_services_cache["data"]:
        return _altegio_services_cache["data"]
    try:
        services = await altegio_client.get_services()
        _altegio_services_cache["data"] = services or []
        _altegio_services_cache["fetched_at"] = now
    except Exception as e:
        logging.error(f"Failed to refresh Altegio services cache: {e}")
    return _altegio_services_cache["data"]


def _normalize_for_match(s: str) -> str:
    """Lowercase + keep only alphanumerics (any unicode letter/digit)."""
    if not s:
        return ""
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _tokens_for_match(s: str) -> set[str]:
    """Tokenize title for forgiving Altegio matching.

    Altegio service titles and local event titles often differ by punctuation
    or conjunctions, e.g. `ЧАЙНА ЦЕРЕМОНІЯ + МЕДИТАЦІЯ` vs
    `чайна церемонія і медитація`. Exact normalized substring matching
    misses those, so compare meaningful title tokens as well.
    """
    if not s:
        return set()
    stopwords = {"і", "й", "та", "and"}
    tokens = []
    current = []
    for ch in s.lower():
        if ch.isalnum():
            current.append(ch)
        elif current:
            token = "".join(current)
            if len(token) > 1 and token not in stopwords:
                tokens.append(token)
            current = []
    if current:
        token = "".join(current)
        if len(token) > 1 and token not in stopwords:
            tokens.append(token)
    return set(tokens)


def _titles_match(a: str, b: str) -> bool:
    a_norm = _normalize_for_match(a)
    b_norm = _normalize_for_match(b)
    if a_norm and b_norm and (a_norm == b_norm or a_norm in b_norm or b_norm in a_norm):
        return True

    a_tokens = _tokens_for_match(a)
    b_tokens = _tokens_for_match(b)
    if not a_tokens or not b_tokens:
        return False

    overlap = a_tokens & b_tokens
    shorter = min(len(a_tokens), len(b_tokens))
    # Require most of the shorter title to match. This keeps matching strict
    # enough for same-date events, while tolerating punctuation/conjunctions.
    return len(overlap) >= max(1, min(shorter, 2)) and (len(overlap) / shorter) >= 0.67


def _altegio_booked_count(altegio_event: dict) -> int:
    for key in ("records_count", "booked_count", "bookings_count", "clients_count"):
        value = altegio_event.get(key)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                pass
    records = altegio_event.get("records") or altegio_event.get("bookings")
    if isinstance(records, list):
        return len(records)
    return 0


def _altegio_activity_url(activity_id: Optional[str] = None) -> Optional[str]:
    if not ALTEGIO_COMPANY_ID:
        return None
    base = f"https://n{ALTEGIO_COMPANY_ID}.alteg.io/company/{ALTEGIO_COMPANY_ID}"
    if activity_id:
        return f"{base}/activity/{activity_id}"
    return f"{base}/menu"


def _google_calendar_event_id(event: Optional[dict]) -> Optional[str]:
    if not event:
        return None
    return event.get("google_calendar_event_id") or event.get("google_calendar_id")


def _altegio_event_title(altegio_event: dict) -> str:
    return altegio_event.get("service", {}).get("title", "") or altegio_event.get("title", "") or ""


def _altegio_event_date(altegio_event: dict) -> str:
    return (altegio_event.get("date") or "").split(" ")[0]


async def _find_local_event_for_altegio(altegio_event: dict) -> Optional[dict]:
    """Find a local event by exact Altegio id first, then normalized title+date."""
    altegio_id = str(altegio_event.get("id") or "")
    if altegio_id:
        local_event = await db.events.find_one({
            "$or": [
                {"altegio_id": altegio_id},
                {"altegio_activity_id": altegio_id},
            ]
        })
        if local_event:
            return local_event

    title = _altegio_event_title(altegio_event)
    date_part = _altegio_event_date(altegio_event)
    if not title:
        return None

    query = {"cancelled": {"$ne": True}, "archived": {"$ne": True}}
    if date_part:
        query["date"] = {"$regex": f"^{date_part}"}

    candidates = await db.events.find(query).to_list(500)
    for event in candidates:
        if _titles_match(event.get("title", ""), title):
            return event
    return None


async def _sync_altegio_events_to_local(altegio_events: list) -> tuple[int, list]:
    synced_count = 0
    synced_events = []

    for altegio_event in altegio_events:
        altegio_id = str(altegio_event.get("id") or "")
        if not altegio_id:
            continue

        local_event = await _find_local_event_for_altegio(altegio_event)
        if not local_event:
            continue

        booked_count = _altegio_booked_count(altegio_event)
        title = _altegio_event_title(altegio_event)
        await db.events.update_one(
            {"id": local_event["id"]},
            {"$set": {
                "altegio_id": altegio_id,
                "altegio_activity_id": altegio_id,
                "altegio_booked_count": booked_count,
                "spots": int(altegio_event.get("capacity") or local_event.get("spots") or 10),
                "altegio_last_sync": datetime.now(timezone.utc).isoformat()
            }}
        )
        synced_events.append({
            "local_id": local_event["id"],
            "altegio_id": altegio_id,
            "title": title,
            "booked_count": booked_count
        })
        synced_count += 1

    return synced_count, synced_events


def _unique_altegio_service_id(services: list, reason: str) -> Optional[int]:
    ids = {int(svc["id"]) for svc in services if svc.get("id")}
    if len(ids) == 1:
        return next(iter(ids))
    if len(ids) > 1:
        titles = ", ".join(f"{svc.get('id')}:{svc.get('title')}" for svc in services[:6])
        logging.warning(f"Altegio service match is ambiguous for {reason}: {titles}")
    return None


async def _altegio_service_id_by_normalized_title(target_title: str) -> Optional[int]:
    services = await _get_altegio_services_cached()
    target_norm = _normalize_for_match(target_title)
    if not services or not target_norm:
        return None

    matches = [svc for svc in services if _normalize_for_match(svc.get("title", "")) == target_norm]
    return _unique_altegio_service_id(matches, f"exact '{target_title}'")


async def _altegio_match_service_by_title(title: str) -> Optional[int]:
    """Safely match an event title to an Altegio service id.

    Only deterministic matches are allowed: one exact normalised title match, or
    one strong substring match. Ambiguous matches return None so callers fail
    loudly instead of creating a booking under the wrong service.
    """
    services = await _get_altegio_services_cached()
    if not services:
        return None
    t_norm = _normalize_for_match(title)
    if not t_norm:
        return None

    exact = [svc for svc in services if _normalize_for_match(svc.get("title", "")) == t_norm]
    exact_id = _unique_altegio_service_id(exact, f"exact '{title}'")
    if exact_id:
        return exact_id
    if exact:
        return None

    # Substring fallback is intentionally conservative: tiny titles and very
    # short overlaps are too risky for booking-critical service selection.
    if len(t_norm) < 5:
        return None

    substring_matches = []
    for svc in services:
        s_norm = _normalize_for_match(svc.get("title", ""))
        if not s_norm or len(s_norm) < 5:
            continue
        if t_norm in s_norm or s_norm in t_norm:
            overlap = min(len(t_norm), len(s_norm))
            if overlap >= 5:
                substring_matches.append(svc)

    return _unique_altegio_service_id(substring_matches, f"substring '{title}'")


def _altegio_event_type_key(title: str, spots: Optional[int] = None) -> Optional[str]:
    title_norm = _normalize_for_match(title)

    if "кадл" in title_norm or "kadl" in title_norm:
        return "kadli_medium" if (spots or 0) > 10 else "kadli_short"
    if "акро" in title_norm or "acro" in title_norm:
        return "acro_yoga"
    return None


async def _mapped_altegio_service_id(title: str, spots: Optional[int] = None) -> Optional[int]:
    event_type_key = _altegio_event_type_key(title, spots)
    if not event_type_key:
        return None

    settings = await get_settings()
    service_id = (settings.altegio_service_mappings or {}).get(event_type_key)
    return int(service_id) if service_id else None


async def _resolve_altegio_service_id(title: str, explicit_service_id: Optional[int] = None, spots: Optional[int] = None) -> Optional[int]:
    """Resolve the Altegio service for an event.

    Known Poriadok event types use the settings-backed mapping first. That keeps
    booking-critical pushes deterministic and leaves fuzzy matching as fallback.
    """
    mapped = await _mapped_altegio_service_id(title, spots)
    if mapped:
        return mapped

    if explicit_service_id:
        return int(explicit_service_id)

    return await _altegio_match_service_by_title(title)


async def _persist_event(event_data: EventCreate, settings, source_event_id: str = "", sync_external: bool = True) -> Event:
    """Insert one event into DB; optionally push to Google Calendar + Altegio.

    Used by both single-event creation and regular-series expansion.
    Children of a series (source_event_id present) skip series_master_only
    tasks — those are attached only to the master.
    """
    is_series_child = bool(source_event_id)
    # Master also belongs to a series (event_type='regular' but no source).
    is_series = is_series_child or (event_data.event_type == "regular")
    reminders = calculate_reminder_dates(event_data.date, settings.reminder_types, is_series_child=is_series_child, is_series=is_series)
    smm_tasks = calculate_smm_dates(event_data.date, is_series_child=is_series_child, is_series=is_series)
    marketing_tasks = calculate_marketing_dates(event_data.date, is_series_child=is_series_child, is_series=is_series)

    payload = event_data.model_dump()
    if source_event_id:
        payload["source_event_id"] = source_event_id

    event = Event(
        **payload,
        reminders=reminders,
        completed_tasks={},
        smm_tasks=smm_tasks,
        completed_smm_tasks={},
        marketing_tasks=marketing_tasks,
        completed_marketing_tasks={},
    )

    await db.events.insert_one(event.model_dump())

    if sync_external:
        await _sync_event_to_external(event)
        updated = await db.events.find_one({"id": event.id}, {"_id": 0})
        if updated:
            return Event(**updated)

    return event


async def _sync_event_to_external(event: Event) -> None:
    """Best-effort push to Google Calendar + Altegio for a single event."""
    # Google Calendar
    try:
        creds = await get_google_credentials()
        if creds:
            service = build('calendar', 'v3', credentials=creds)
            try:
                event_date = datetime.fromisoformat(event.date.replace('Z', '+00:00'))
            except Exception:
                event_date = datetime.strptime(event.date[:10], '%Y-%m-%d')

            start_time = event.start_time or ''
            end_time = event.end_time or ''
            calendar_event = {
                'summary': event.title,
                'description': f"{event.description or ''}\n\nціна: {event.price} грн\nмісць: {event.spots}",
            }
            if start_time and end_time:
                date_str = event_date.strftime('%Y-%m-%d')
                calendar_event['start'] = {'dateTime': f"{date_str}T{start_time}:00", 'timeZone': 'Europe/Kyiv'}
                calendar_event['end'] = {'dateTime': f"{date_str}T{end_time}:00", 'timeZone': 'Europe/Kyiv'}
            elif start_time:
                date_str = event_date.strftime('%Y-%m-%d')
                start_hour, start_min = map(int, start_time.split(':'))
                end_hour = (start_hour + 3) % 24
                default_end = f"{end_hour:02d}:{start_min:02d}"
                calendar_event['start'] = {'dateTime': f"{date_str}T{start_time}:00", 'timeZone': 'Europe/Kyiv'}
                calendar_event['end'] = {'dateTime': f"{date_str}T{default_end}:00", 'timeZone': 'Europe/Kyiv'}
            else:
                calendar_event['start'] = {'date': event_date.strftime('%Y-%m-%d'), 'timeZone': 'Europe/Kyiv'}
                calendar_event['end'] = {'date': (event_date + timedelta(days=1)).strftime('%Y-%m-%d'), 'timeZone': 'Europe/Kyiv'}

            result = service.events().insert(calendarId='primary', body=calendar_event).execute()
            await db.events.update_one({"id": event.id}, {"$set": {"google_calendar_id": result.get("id"), "google_calendar_event_id": result.get("id")}})
            logging.info(f"Auto-exported event {event.title} to Google Calendar")
    except Exception as e:
        logging.error(f"Failed to auto-export to Google Calendar: {e}")

    # Altegio: explicit service_id wins; otherwise fuzzy-match the event title
    # against the Altegio service catalogue. If no match — silently skip push
    # (Altegio API forbids us from creating services).
    try:
        if ALTEGIO_PARTNER_TOKEN:
            service_id = await _resolve_altegio_service_id(
                event.title,
                explicit_service_id=event.altegio_service_id or ALTEGIO_DEFAULT_SERVICE_ID or None,
                spots=event.spots,
            )
            if service_id and int(service_id) != (event.altegio_service_id or 0):
                # Persist match so subsequent updates reuse it without re-matching
                await db.events.update_one({"id": event.id}, {"$set": {"altegio_service_id": int(service_id)}})
            if service_id:
                result = await altegio_client.create_activity_result(
                    title=event.title,
                    date=event.date[:10],
                    start_time=event.start_time or "14:00",
                    end_time=event.end_time or "16:00",
                    capacity=event.spots or 10,
                    comment=event.description or "",
                    service_id=int(service_id),
                )
                if result.get("ok") and result.get("activity_id"):
                    altegio_id = str(result["activity_id"])
                    await db.events.update_one(
                        {"id": event.id},
                        {"$set": {
                            "altegio_activity_id": altegio_id,
                            "altegio_id": altegio_id,
                            "altegio_service_id": int(service_id),
                            "altegio_last_sync": datetime.now(timezone.utc).isoformat(),
                            "altegio_last_error": None,
                            "altegio_last_status_code": result.get("status_code"),
                        }}
                    )
                    logging.info(f"Auto-pushed event '{event.title}' to Altegio: {altegio_id}")
                else:
                    error_body = result.get("body")
                    if not isinstance(error_body, str):
                        error_body = str(error_body)
                    await db.events.update_one(
                        {"id": event.id},
                        {"$set": {
                            "altegio_service_id": int(service_id),
                            "altegio_last_error": error_body[:1000],
                            "altegio_last_status_code": result.get("status_code"),
                            "altegio_last_sync": datetime.now(timezone.utc).isoformat(),
                        }}
                    )
                    logging.error(f"Altegio auto-push failed for '{event.title}': {result.get('status_code')} - {error_body[:300]}")
            else:
                logging.info(f"Altegio push skipped — no matching service for '{event.title}'")
    except Exception as e:
        logging.error(f"Failed to push event to Altegio: {e}")


@api_router.post("/events")
async def create_event(event_data: EventCreate, request: Request):
    actor = _actor_from_request(request)
    settings = await get_settings()

    is_regular = event_data.event_type == "regular" and bool(event_data.repeat_days)

    if not is_regular:
        # Single one-off event — full external sync
        event = await _persist_event(event_data, settings, sync_external=True)
        _notify_team(actor, f"📅 створено подію: {_event_line(event.model_dump())}\n{_poriadok_link()}")
        return {**event.model_dump(), "series_count": 1}

    # Regular series — expand to SERIES_WEEKS of instances on selected weekdays
    SERIES_WEEKS = 6
    try:
        start_dt = datetime.strptime(event_data.date[:10], '%Y-%m-%d').date()
    except Exception:
        start_dt = datetime.now(timezone.utc).date()
    today = datetime.now(timezone.utc).date()
    if start_dt < today:
        start_dt = today
    end_dt = start_dt + timedelta(weeks=SERIES_WEEKS)

    # Collect all dates within window matching the chosen weekdays
    dates: List[date] = []
    cur = start_dt
    while cur < end_dt:
        if cur.weekday() in event_data.repeat_days:
            dates.append(cur)
        cur += timedelta(days=1)

    if not dates:
        raise HTTPException(status_code=400, detail="Жоден день тижня не потрапляє в найближчі 6 тижнів")

    # First instance is the master; every generated instance is pushed to Altegio
    # so the booking calendar has a real activity for each occurrence.
    master_payload = event_data.model_copy(update={"date": dates[0].isoformat()})
    master = await _persist_event(master_payload, settings, sync_external=True)

    for d in dates[1:]:
        child_payload = event_data.model_copy(update={"date": d.isoformat()})
        await _persist_event(child_payload, settings, source_event_id=master.id, sync_external=True)

    # Post-process: pay_master fires once per calendar month — on the LAST
    # instance of that month. Master/children otherwise skip mgmt_pay_master
    # (series_master_only=True). This pass adds it back to the right instance.
    await _attach_monthly_pay_master(master.id, dates)

    _notify_team(actor, f"📅 створено серію подій: {_event_line(master.model_dump())} (+{len(dates) - 1})\n{_poriadok_link()}")

    return {**master.model_dump(), "series_count": len(dates)}


async def _attach_monthly_pay_master(master_id: str, dates: List[date]) -> None:
    """For a regular series, mark mgmt_pay_master on the last instance of each
    calendar month. Other instances keep it stripped via series_master_only."""
    last_per_month: Dict[str, date] = {}
    for d in dates:
        ym = d.isoformat()[:7]  # "YYYY-MM"
        if ym not in last_per_month or d > last_per_month[ym]:
            last_per_month[ym] = d
    pay_dates = set(last_per_month.values())

    instances = await db.events.find(
        {"$or": [{"id": master_id}, {"source_event_id": master_id}]},
        {"_id": 0, "id": 1, "date": 1},
    ).to_list(1000)
    for inst in instances:
        try:
            inst_date = datetime.strptime(inst["date"][:10], "%Y-%m-%d").date()
        except Exception:
            continue
        if inst_date in pay_dates:
            await db.events.update_one(
                {"id": inst["id"]},
                {"$set": {"reminders.mgmt_pay_master": inst["date"][:10]}},
            )


# legacy block below preserved as no-op for diff readability
async def _create_event_legacy_keepalive(event_data: EventCreate):  # pragma: no cover
    settings = await get_settings()
    reminders = calculate_reminder_dates(event_data.date, settings.reminder_types)
    smm_tasks = calculate_smm_dates(event_data.date)
    marketing_tasks = calculate_marketing_dates(event_data.date)

    event = Event(
        **event_data.model_dump(),
        reminders=reminders,
        completed_tasks={},
        smm_tasks=smm_tasks,
        completed_smm_tasks={},
        marketing_tasks=marketing_tasks,
        completed_marketing_tasks={}
    )

    await db.events.insert_one(event.model_dump())

    # Auto-export to Google Calendar if connected
    try:
        creds = await get_google_credentials()
        if creds:
            service = build('calendar', 'v3', credentials=creds)
            
            try:
                event_date = datetime.fromisoformat(event.date.replace('Z', '+00:00'))
            except:
                event_date = datetime.strptime(event.date[:10], '%Y-%m-%d')
            
            start_time = event.start_time or ''
            end_time = event.end_time or ''
            
            calendar_event = {
                'summary': event.title,
                'description': f"{event.description or ''}\n\nціна: {event.price} грн\nмісць: {event.spots}",
            }
            
            if start_time and end_time:
                date_str = event_date.strftime('%Y-%m-%d')
                calendar_event['start'] = {'dateTime': f"{date_str}T{start_time}:00", 'timeZone': 'Europe/Kyiv'}
                calendar_event['end'] = {'dateTime': f"{date_str}T{end_time}:00", 'timeZone': 'Europe/Kyiv'}
            elif start_time:
                date_str = event_date.strftime('%Y-%m-%d')
                start_hour, start_min = map(int, start_time.split(':'))
                end_hour = (start_hour + 3) % 24
                default_end = f"{end_hour:02d}:{start_min:02d}"
                calendar_event['start'] = {'dateTime': f"{date_str}T{start_time}:00", 'timeZone': 'Europe/Kyiv'}
                calendar_event['end'] = {'dateTime': f"{date_str}T{default_end}:00", 'timeZone': 'Europe/Kyiv'}
            else:
                calendar_event['start'] = {'date': event_date.strftime('%Y-%m-%d'), 'timeZone': 'Europe/Kyiv'}
                calendar_event['end'] = {'date': (event_date + timedelta(days=1)).strftime('%Y-%m-%d'), 'timeZone': 'Europe/Kyiv'}
            
            result = service.events().insert(calendarId='primary', body=calendar_event).execute()
            await db.events.update_one({"id": event.id}, {"$set": {"google_calendar_id": result.get("id"), "google_calendar_event_id": result.get("id")}})
            logging.info(f"Auto-exported event {event.title} to Google Calendar")
    except Exception as e:
        logging.error(f"Failed to auto-export to Google Calendar: {e}")
    
    # Auto-push to Altegio if configured (per-event service_id wins, default as fallback)
    try:
        effective_service_id = event.altegio_service_id or ALTEGIO_DEFAULT_SERVICE_ID
        if ALTEGIO_PARTNER_TOKEN and effective_service_id:
            altegio_id = await altegio_client.create_activity(
                title=event.title,
                date=event.date[:10],
                start_time=event.start_time or "14:00",
                end_time=event.end_time or "16:00",
                capacity=event.spots or 10,
                comment=event.description or "",
                service_id=event.altegio_service_id
            )
            if altegio_id:
                await db.events.update_one({"id": event.id}, {"$set": {"altegio_activity_id": str(altegio_id)}})
                logging.info(f"Auto-pushed event '{event.title}' to Altegio: {altegio_id}")
    except Exception as e:
        logging.error(f"Failed to push event to Altegio: {e}")
    
    return event

@api_router.get("/events", response_model=List[Event])
async def get_events():
    # Auto-archive past events (events that happened yesterday or earlier)
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    
    # Find and archive past events that are not already archived
    await db.events.update_many(
        {
            "archived": {"$ne": True},
            "cancelled": {"$ne": True},
            "date": {"$lt": today.isoformat()}
        },
        {"$set": {"archived": True}}
    )
    
    events = await db.events.find({}, {"_id": 0}).to_list(1000)
    return events

@api_router.get("/events/past-unique")
async def get_past_unique_events():
    """Get unique past events (no duplicates by title) for repeat selection."""
    all_events = await db.events.find({}, {"_id": 0}).to_list(5000)
    seen = {}
    for e in sorted(all_events, key=lambda x: x.get("date", ""), reverse=True):
        title = e.get("title", "").strip().lower()
        if title and title not in seen:
            seen[title] = {"id": e["id"], "title": e["title"], "price": e.get("price", 0), "spots": e.get("spots", 10), "description": e.get("description", ""), "start_time": e.get("start_time", ""), "end_time": e.get("end_time", ""), "date": e.get("date", "")}
    return list(seen.values())

@api_router.get("/events/{event_id}", response_model=Event)
async def get_event(event_id: str):
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event

@api_router.put("/events/{event_id}", response_model=Event)
async def update_event(event_id: str, event_data: EventUpdate):
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")
    
    update_dict = {k: v for k, v in event_data.model_dump().items() if v is not None}
    
    if "date" in update_dict:
        settings = await get_settings()
        reminders = calculate_reminder_dates(update_dict["date"], settings.reminder_types)
        smm_tasks = calculate_smm_dates(update_dict["date"])
        update_dict["reminders"] = reminders
        update_dict["smm_tasks"] = smm_tasks
    
    # If cancelling event, clear all pending tasks
    if update_dict.get("cancelled") == True:
        update_dict["completed_tasks"] = {}
        update_dict["completed_smm_tasks"] = {}
        update_dict["completed_marketing_tasks"] = {}
        update_dict["reminders"] = {}
        update_dict["smm_tasks"] = {}
    
    if update_dict:
        await db.events.update_one({"id": event_id}, {"$set": update_dict})
    
    updated = await db.events.find_one({"id": event_id}, {"_id": 0})
    
    # Push changes to Altegio if linked
    try:
        altegio_id = updated.get("altegio_activity_id") or existing.get("altegio_activity_id")
        if altegio_id and ALTEGIO_PARTNER_TOKEN:
            if update_dict.get("cancelled"):
                await altegio_client.delete_activity(altegio_id)
                await db.events.update_one({"id": event_id}, {"$set": {"altegio_activity_id": None, "altegio_id": None}})
            else:
                await altegio_client.update_activity(
                    activity_id=altegio_id,
                    title=updated.get("title", existing.get("title", "")),
                    date=updated.get("date", existing.get("date", ""))[:10],
                    start_time=updated.get("start_time") or existing.get("start_time") or "14:00",
                    end_time=updated.get("end_time") or existing.get("end_time") or "16:00",
                    capacity=updated.get("spots") or existing.get("spots") or 10,
                    comment=updated.get("description") or existing.get("description") or "",
                    service_id=await _resolve_altegio_service_id(
                        updated.get("title", existing.get("title", "")),
                        explicit_service_id=updated.get("altegio_service_id") or existing.get("altegio_service_id"),
                        spots=updated.get("spots") or existing.get("spots") or 10,
                    )
                )
    except Exception as e:
        logging.error(f"Failed to sync event update to Altegio: {e}")
    
    return updated

async def _create_cancellation_tasks(event: dict, series_count: int = 0) -> int:
    """Generate the manual follow-up tasks that fire when an event is cancelled.

    External cleanup (Altegio activity delete + Google Calendar event delete)
    happens automatically in the cancellation handlers, so no task is created
    for that. We only create the human-loop work:

    1. Notify the master that their event is off.
    2. Refund participants or move payments to deposit.

    Both go to Manager (management column), dated today, linked to the
    cancelled event so the popup can show context.
    """
    title = event.get("title") or "подія"
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    suffix = f" (та ще {series_count - 1} в серії)" if series_count > 1 else ""
    event_id = event.get("id") or "event"

    tasks = [
        {
            "id": f"cancel-{event_id}-master",
            "title": f"повідомити майстра про скасування «{title}»{suffix}",
            "icon": "bell",
        },
        {
            "id": f"cancel-{event_id}-participants",
            "title": f"повідомити учасників «{title}» — повернути кошти або занести на депозит",
            "icon": "wallet",
        },
    ]

    created = 0
    for spec in tasks:
        standalone = StandaloneTask(
            id=spec["id"],
            title=spec["title"],
            date=today_str,
            icon=spec["icon"],
            type="regular",
            color="manager",
            assignee="manager",
            event_id=event_id,
        )
        result = await db.standalone_tasks.update_one(
            {"id": standalone.id},
            {"$setOnInsert": standalone.model_dump()},
            upsert=True,
        )
        if result.upserted_id:
            created += 1

    if created:
        enqueue_telegram("manager", f"📋 створено таски для скасування: {_event_line(event)}\n{_poriadok_link()}")
    return created


@api_router.patch("/events/{event_id}", response_model=Event)
async def patch_event(event_id: str, event_data: dict, request: Request):
    """Patch event - used for cancel/restore functionality"""
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    update_dict = {}

    # Handle cancellation
    if event_data.get("cancelled") == True:
        existing = await _refresh_event_payment_snapshot(existing)
        if _event_paid_count(existing) > 0 and not _event_cancellation_confirmed(event_data, request):
            try:
                await _create_cancellation_tasks(existing)
            except Exception as e:
                logging.error(f"Failed to create cancellation tasks for {event_id}: {e}")
            await db.events.update_one(
                {"id": event_id},
                {"$set": {
                    "cancellation_pending": True,
                    "cancellation_requested_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            raise HTTPException(status_code=409, detail=_cancellation_guard_detail(existing, "cancel"))

        update_dict["cancelled"] = True
        update_dict["cancellation_pending"] = False
        update_dict["cancellation_manager_confirmed"] = _event_cancellation_confirmed(event_data, request)
        if update_dict["cancellation_manager_confirmed"]:
            update_dict["cancellation_confirmed_at"] = datetime.now(timezone.utc).isoformat()
        # Clear all reminders and tasks when cancelling
        update_dict["reminders"] = {}
        update_dict["smm_tasks"] = {}

        # Spawn manual follow-up tasks (notify master, handle refunds).
        # External cleanup (Altegio + Google Calendar) is automated below.
        try:
            await _create_cancellation_tasks(existing)
        except Exception as e:
            logging.error(f"Failed to create cancellation tasks for {event_id}: {e}")
        
        # Delete from Google Calendar if exists
        google_calendar_event_id = _google_calendar_event_id(existing)
        if google_calendar_event_id:
            try:
                service = await get_google_calendar_service()
                if service:
                    service.events().delete(calendarId='primary', eventId=google_calendar_event_id).execute()
                    logging.info(f"Deleted event {event_id} from Google Calendar")
                    update_dict["google_calendar_event_id"] = None
                    update_dict["google_calendar_id"] = None
            except Exception as e:
                logging.error(f"Failed to delete from Google Calendar: {e}")
    
    # Handle restoration
    elif event_data.get("cancelled") == False:
        update_dict["cancelled"] = False
        update_dict["cancellation_pending"] = False
        update_dict["cancellation_manager_confirmed"] = False
        update_dict["cancellation_confirmed_at"] = None
        # Restore reminders and SMM tasks based on event date
        settings = await get_settings()
        update_dict["reminders"] = calculate_reminder_dates(existing["date"], settings.reminder_types)
        update_dict["smm_tasks"] = calculate_smm_dates(existing["date"])
    
    if update_dict:
        await db.events.update_one({"id": event_id}, {"$set": update_dict})
    
    updated = await db.events.find_one({"id": event_id}, {"_id": 0})
    actor = _actor_from_request(request)
    if event_data.get("cancelled") == True and not existing.get("cancelled"):
        _notify_team(actor, f"📅 скасовано подію: {_event_line(existing)}\n{_poriadok_link()}")
    elif event_data.get("cancelled") == False and existing.get("cancelled"):
        _notify_team(actor, f"📅 відновлено подію: {_event_line(updated)}\n{_poriadok_link()}")
    
    # Sync cancel/restore to Altegio
    try:
        altegio_id = existing.get("altegio_activity_id")
        if altegio_id and ALTEGIO_PARTNER_TOKEN:
            if update_dict.get("cancelled"):
                await altegio_client.delete_activity(altegio_id)
            elif event_data.get("cancelled") == False:
                # Recreate activity on restore
                new_id = await altegio_client.create_activity(
                    title=updated.get("title", ""),
                    date=updated.get("date", "")[:10],
                    start_time=updated.get("start_time") or "14:00",
                    end_time=updated.get("end_time") or "16:00",
                    capacity=updated.get("spots") or 10,
                    comment=updated.get("description") or "",
                    service_id=await _resolve_altegio_service_id(
                        updated.get("title", existing.get("title", "")),
                        explicit_service_id=updated.get("altegio_service_id") or existing.get("altegio_service_id"),
                        spots=updated.get("spots") or existing.get("spots") or 10,
                    )
                )
                if new_id:
                    await db.events.update_one(
                        {"id": event_id},
                        {"$set": {"altegio_activity_id": str(new_id), "altegio_id": str(new_id)}}
                    )
    except Exception as e:
        logging.error(f"Failed to sync cancel/restore to Altegio: {e}")
    
    return updated

@api_router.post("/events/{event_id}/cancel-series")
async def cancel_event_series(event_id: str, request: Request):
    """Cancel this event AND all future events in the same recurring series.

    Series membership: an event is part of a series if it has a non-empty
    source_event_id (it's a child) OR if other events reference it via
    source_event_id (it's the master).

    "Future" means date >= the supplied event's date. Events already
    cancelled are skipped.
    """
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    master_id = existing.get("source_event_id") or event_id
    cutoff_date = existing.get("date", "")

    # All series instances at or after the cutoff that are still active
    cursor = db.events.find({
        "$or": [{"id": master_id}, {"source_event_id": master_id}],
        "date": {"$gte": cutoff_date},
        "cancelled": {"$ne": True},
    }, {"_id": 0})
    targets = await cursor.to_list(1000)

    targets = [await _refresh_event_payment_snapshot(t) for t in targets]

    if any(_event_paid_count(t) > 0 for t in targets) and request.query_params.get("manager_confirmed_cancellation") != "true":
        anchor = next((t for t in targets if _event_paid_count(t) > 0), existing)
        try:
            await _create_cancellation_tasks(anchor, series_count=len(targets))
        except Exception as e:
            logging.error(f"Failed to create cancellation tasks for series {master_id}: {e}")
        await db.events.update_many(
            {"id": {"$in": [t["id"] for t in targets]}},
            {"$set": {
                "cancellation_pending": True,
                "cancellation_requested_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(status_code=409, detail=_cancellation_guard_detail(anchor, "cancel-series"))

    cancelled_ids: List[str] = []
    for t in targets:
        tid = t["id"]
        await db.events.update_one(
            {"id": tid},
            {"$set": {
                "cancelled": True,
                "reminders": {},
                "smm_tasks": {},
                "cancellation_pending": False,
                "cancellation_manager_confirmed": request.query_params.get("manager_confirmed_cancellation") == "true",
                "cancellation_confirmed_at": datetime.now(timezone.utc).isoformat() if request.query_params.get("manager_confirmed_cancellation") == "true" else None,
            }},
        )
        cancelled_ids.append(tid)

        # Best-effort external cleanup per instance
        gcal_id = _google_calendar_event_id(t)
        if gcal_id:
            try:
                service = await get_google_calendar_service()
                if service:
                    service.events().delete(calendarId='primary', eventId=gcal_id).execute()
                    await db.events.update_one({"id": tid}, {"$set": {"google_calendar_event_id": None, "google_calendar_id": None}})
            except Exception as e:
                logging.error(f"Failed to delete series instance {tid} from Google Calendar: {e}")

        altegio_id = t.get("altegio_activity_id")
        if altegio_id and ALTEGIO_PARTNER_TOKEN:
            try:
                await altegio_client.delete_activity(altegio_id)
                await db.events.update_one({"id": tid}, {"$set": {"altegio_activity_id": None}})
            except Exception as e:
                logging.error(f"Failed to delete series instance {tid} from Altegio: {e}")

    # One set of follow-up tasks for the whole series (master event used as
    # the anchor; suffix indicates additional instances).
    if cancelled_ids:
        anchor = next((t for t in targets if t["id"] == cancelled_ids[0]), targets[0])
        try:
            await _create_cancellation_tasks(anchor, series_count=len(cancelled_ids))
        except Exception as e:
            logging.error(f"Failed to create cancellation tasks for series {master_id}: {e}")
        actor = _actor_from_request(request)
        _notify_team(actor, f"📅 скасовано серію подій: {_event_line(anchor)} (+{len(cancelled_ids) - 1})\n{_poriadok_link()}")

    return {"cancelled_count": len(cancelled_ids), "cancelled_ids": cancelled_ids, "master_id": master_id}


@api_router.get("/events/{event_id}/series")
async def get_event_series(event_id: str):
    """Return all events in the same regular series as the supplied event,
    sorted by date. Useful for showing 'this is part of a series' UI with
    a clickable list of all instances.

    Series membership: master = the event with source_event_id="" whose
    own id appears as source_event_id of children. Given any event, we
    resolve master_id, then collect master + every event linking to it.
    """
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")

    master_id = existing.get("source_event_id") or event_id
    cursor = db.events.find(
        {"$or": [{"id": master_id}, {"source_event_id": master_id}]},
        {
            "_id": 0, "id": 1, "title": 1, "date": 1,
            "start_time": 1, "end_time": 1,
            "spots": 1, "altegio_booked_count": 1,
            "cancelled": 1, "archived": 1,
            "source_event_id": 1,
        },
    )
    instances = await cursor.to_list(1000)
    instances.sort(key=lambda e: e.get("date", ""))

    enriched = []
    for inst in instances:
        is_master = inst["id"] == master_id
        is_current = inst["id"] == event_id
        enriched.append({
            **inst,
            "is_master": is_master,
            "is_current": is_current,
        })

    return {
        "master_id": master_id,
        "current_id": event_id,
        "count": len(enriched),
        "events": enriched,
    }


@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str, request: Request):
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
    existing = await _refresh_event_payment_snapshot(existing)
    if existing and _event_paid_count(existing) > 0 and request.query_params.get("manager_confirmed_cancellation") != "true":
        try:
            await _create_cancellation_tasks(existing)
        except Exception as e:
            logging.error(f"Failed to create cancellation tasks for delete guard {event_id}: {e}")
        await db.events.update_one(
            {"id": event_id},
            {"$set": {
                "cancellation_pending": True,
                "cancellation_requested_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(status_code=409, detail=_cancellation_guard_detail(existing, "delete"))

    result = await db.events.delete_one({"id": event_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")

    # Delete from Altegio if linked
    try:
        altegio_id = existing.get("altegio_activity_id") if existing else None
        if altegio_id and ALTEGIO_PARTNER_TOKEN:
            await altegio_client.delete_activity(altegio_id)
    except Exception as e:
        logging.error(f"Failed to delete event from Altegio: {e}")

    # Delete from Google Calendar if linked
    try:
        gcal_id = _google_calendar_event_id(existing)
        if gcal_id:
            service = await get_google_calendar_service()
            if service:
                service.events().delete(calendarId='primary', eventId=gcal_id).execute()
    except Exception as e:
        logging.error(f"Failed to delete event from Google Calendar: {e}")

    # Spawn the same manual follow-up tasks as a soft cancel — deleting a
    # future event does not relieve the obligation to notify the master and
    # handle participant refunds.
    if existing:
        try:
            await _create_cancellation_tasks(existing)
        except Exception as e:
            logging.error(f"Failed to create cancellation tasks for deleted {event_id}: {e}")
        actor = _actor_from_request(request)
        _notify_team(actor, f"📅 видалено подію: {_event_line(existing)}\n{_poriadok_link()}")

    return {"message": "Event deleted"}

# ==================== STANDALONE TASKS API ====================

@api_router.post("/tasks/standalone", response_model=StandaloneTask)
async def create_standalone_task(task_data: StandaloneTaskCreate, request: Request):
    task_data.assignee = normalize_assignee(task_data.assignee)
    task = StandaloneTask(**task_data.model_dump())
    await db.standalone_tasks.insert_one(task.model_dump())
    actor = _actor_from_request(request)
    _notify_assignee(
        actor,
        task.assignee,
        f"➕ новий таск для тебе: <b>{_html_escape(task.title)}</b> — {_format_task_date(task.date)}\n{_poriadok_link()}",
    )
    return task

@api_router.get("/tasks/standalone", response_model=List[StandaloneTask])
async def get_standalone_tasks():
    tasks = await db.standalone_tasks.find({}, {"_id": 0}).to_list(1000)
    return tasks

# ==================== DAY-OFFS ====================

ASSIGNEE_TO_COLUMN = {
    "manager": "management",
    "smm":    "smm",
    "marketer":       "marketing",
}
COLUMN_TO_FIELD = {
    "management": "reminders",
    "smm":        "smm_tasks",
    "marketing":  "marketing_tasks",
}
COLUMN_TO_COMPLETED_FIELD = {
    "management": "completed_tasks",
    "smm":        "completed_smm_tasks",
    "marketing":  "completed_marketing_tasks",
}


async def _suggest_redistribution(assignee: str, day_off_date: str) -> Dict:
    """Build a redistribution plan for a single day off.

    Returns:
        {
          "auto_shifts":   safe shifts the system applies on its own
          "needs_review":  items the user must decide (fixed / chain / no slot)
        }
    """
    assignee = normalize_assignee(assignee)
    column = ASSIGNEE_TO_COLUMN.get(assignee)
    if not column:
        return {"auto_shifts": [], "needs_review": []}

    task_defs = {t["id"]: t for t in get_tasks_for_column(column)}
    field = COLUMN_TO_FIELD[column]
    completed_field = COLUMN_TO_COMPLETED_FIELD[column]

    try:
        day_off_dt = datetime.strptime(day_off_date[:10], "%Y-%m-%d").date()
    except Exception:
        return {"auto_shifts": [], "needs_review": []}

    # Pre-compute load per day in a wide window so we can pick less-loaded neighbours.
    window_start = (day_off_dt - timedelta(days=7)).isoformat()
    window_end   = (day_off_dt + timedelta(days=7)).isoformat()

    cursor = db.events.find({"cancelled": {"$ne": True}}, {"_id": 0})
    events = await cursor.to_list(2000)

    load_by_day: Dict[str, float] = {}
    affected: List = []  # (event, task_id, current_date)
    for event in events:
        tasks_on_event = event.get(field, {}) or {}
        completed_map = event.get(completed_field, {}) or {}
        for task_id, task_date in tasks_on_event.items():
            if not task_date or task_id not in task_defs:
                continue
            td = task_defs[task_id]
            w = float(td.get("weight", 0.1))
            if window_start <= task_date <= window_end:
                load_by_day[task_date] = load_by_day.get(task_date, 0.0) + w
            if task_date == day_off_date and not completed_map.get(task_id):
                affected.append((event, task_id, task_date))

    auto_shifts: List[Dict] = []
    needs_review: List[Dict] = []

    for event, task_id, task_date in affected:
        td = task_defs[task_id]
        kind = td.get("shift_kind", "easy")
        weight = float(td.get("weight", 0.1))
        name = td.get("name", task_id)
        base = {
            "event_id": event["id"],
            "event_title": event.get("title", ""),
            "task_id": task_id,
            "name": name,
            "original_date": task_date,
            "weight": weight,
            "kind": kind,
            "column": column,
        }

        if kind == "fixed":
            needs_review.append({
                **base,
                "reason": "прив'язано до дати події — переміщати не можна. делегувати або зробити в інший день вручну.",
                "suggested_dates": [],
            })
            continue

        # Build candidate slots ±1, ±2 (skip the day off itself)
        candidates = []
        for delta in [-1, 1, -2, 2]:
            target_dt = day_off_dt + timedelta(days=delta)
            target = target_dt.isoformat()
            target_load = load_by_day.get(target, 0.0)
            candidates.append((delta, target, target_load))
        # Sort by absolute distance first, then by lighter load
        candidates.sort(key=lambda c: (abs(c[0]), c[2]))

        if kind == "chain":
            needs_review.append({
                **base,
                "reason": "частина ланцюжка залежностей. зсув може потягнути за собою інші таски — підтвердь.",
                "suggested_dates": [c[1] for c in candidates[:2]],
            })
            continue

        # easy → take the closest+lightest slot
        chosen = candidates[0]
        new_date = chosen[1]
        # Update virtual load so the next easy task accounts for it
        load_by_day[new_date] = load_by_day.get(new_date, 0.0) + weight
        auto_shifts.append({**base, "new_date": new_date})

    return {"auto_shifts": auto_shifts, "needs_review": needs_review}


@api_router.post("/days-off")
async def create_day_off(payload: DayOff):
    """Create a day off and return the redistribution suggestion in one call."""
    await db.days_off.insert_one(payload.model_dump())
    suggestion = await _suggest_redistribution(payload.assignee, payload.date)
    return {"day_off": payload.model_dump(), **suggestion}


@api_router.get("/days-off")
async def list_days_off():
    days = await db.days_off.find({}, {"_id": 0}).to_list(500)
    days.sort(key=lambda d: d.get("date", ""))
    return days


@api_router.delete("/days-off/{day_off_id}")
async def delete_day_off(day_off_id: str):
    res = await db.days_off.delete_one({"id": day_off_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Day off not found")
    return {"deleted": True}


@api_router.post("/days-off/{day_off_id}/apply")
async def apply_day_off_shifts(day_off_id: str, plan: dict):
    """Apply the user-confirmed redistribution.

    plan = {"shifts": [{event_id, task_id, new_date, column}, ...]}
    Each shift updates the corresponding event's task date in-place.
    """
    shifts = plan.get("shifts", [])
    applied = []
    for s in shifts:
        column = s.get("column")
        if column not in COLUMN_TO_FIELD:
            continue
        field = COLUMN_TO_FIELD[column]
        await db.events.update_one(
            {"id": s["event_id"]},
            {"$set": {f"{field}.{s['task_id']}": s["new_date"]}},
        )
        applied.append(s)
    return {"applied": applied, "count": len(applied)}


# ==================== STANDALONE TASKS API ====================

@api_router.put("/tasks/standalone/{task_id}")
async def update_standalone_task(task_id: str, completed: bool):
    task = await db.standalone_tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    update = {"completed": completed}
    if completed:
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    else:
        update["completed_at"] = None
    
    await db.standalone_tasks.update_one({"id": task_id}, {"$set": update})
    return {"success": True}

@api_router.patch("/tasks/standalone/{task_id}")
async def update_standalone_task_full(task_id: str, task_data: StandaloneTaskCreate, request: Request):
    """Full update of standalone task (title, date, icon, color, type)"""
    existing = await db.standalone_tasks.find_one({"id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Task not found")
    
    update = {
        "title": task_data.title,
        "date": task_data.date,
        "icon": task_data.icon,
        "type": task_data.type,
        "color": task_data.color,
        "assignee": normalize_assignee(task_data.assignee),
        "event_id": task_data.event_id or "",
        "order": task_data.order or 0,
    }
    
    await db.standalone_tasks.update_one({"id": task_id}, {"$set": update})
    updated = await db.standalone_tasks.find_one({"id": task_id}, {"_id": 0})
    return updated

@api_router.delete("/tasks/standalone/{task_id}")
async def delete_standalone_task(task_id: str):
    result = await db.standalone_tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}


# ==================== POSTS API ====================

@api_router.get("/posts", response_model=List[Post])
async def get_posts():
    posts = await db.posts.find({}, {"_id": 0}).to_list(1000)
    return posts

@api_router.post("/posts", response_model=Post)
async def create_post(post: Post):
    await db.posts.insert_one(post.model_dump())
    return post

@api_router.patch("/posts/{post_id}")
async def update_post(post_id: str, data: dict):
    existing = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Post not found")
    allowed = {"title", "date", "notes", "post_type", "completed", "completed_at"}
    update = {k: v for k, v in data.items() if k in allowed}
    if "completed" in update:
        update["completed_at"] = datetime.now(timezone.utc).isoformat() if update["completed"] else None
    if update:
        await db.posts.update_one({"id": post_id}, {"$set": update})
    return {"success": True}

@api_router.delete("/posts/{post_id}")
async def delete_post(post_id: str):
    result = await db.posts.delete_one({"id": post_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"message": "Post deleted"}


# ==================== TASK COMPLETION API ====================

@api_router.post("/tasks/complete")
async def complete_task(request: TaskCompletionRequest):
    event = await db.events.find_one({"id": request.event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    completed_tasks = event.get("completed_tasks", {})
    
    if request.completed:
        completed_tasks[request.reminder_id] = datetime.now(timezone.utc).isoformat()
    else:
        if request.reminder_id in completed_tasks:
            del completed_tasks[request.reminder_id]
    
    await db.events.update_one(
        {"id": request.event_id},
        {"$set": {"completed_tasks": completed_tasks}}
    )
    
    return {"success": True, "completed_tasks": completed_tasks}

# ==================== SMM TASK COMPLETION API ====================

@api_router.post("/tasks/smm/complete")
async def complete_smm_task(request: SMMTaskCompletionRequest):
    event = await db.events.find_one({"id": request.event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    completed_smm_tasks = event.get("completed_smm_tasks", {})
    
    if request.completed:
        completed_smm_tasks[request.task_id] = datetime.now(timezone.utc).isoformat()
    else:
        if request.task_id in completed_smm_tasks:
            del completed_smm_tasks[request.task_id]
    
    await db.events.update_one(
        {"id": request.event_id},
        {"$set": {"completed_smm_tasks": completed_smm_tasks}}
    )
    
    return {"success": True, "completed_smm_tasks": completed_smm_tasks}


@api_router.post("/tasks/marketing/complete")
async def complete_marketing_task(request: SMMTaskCompletionRequest):
    event = await db.events.find_one({"id": request.event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    completed_marketing_tasks = event.get("completed_marketing_tasks", {})
    
    if request.completed:
        completed_marketing_tasks[request.task_id] = datetime.now(timezone.utc).isoformat()
    else:
        if request.task_id in completed_marketing_tasks:
            del completed_marketing_tasks[request.task_id]
    
    await db.events.update_one(
        {"id": request.event_id},
        {"$set": {"completed_marketing_tasks": completed_marketing_tasks}}
    )
    
    return {"success": True, "completed_marketing_tasks": completed_marketing_tasks}


@api_router.patch("/events/{event_id}/tasks/{task_id}")
async def update_event_task(event_id: str, task_id: str, data: dict, request: Request):
    """Update color/icon/assignee overrides and date for an event-based task"""
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    old_date = ""
    task_column = ""
    for column, field in COLUMN_TO_FIELD.items():
        current = (event.get(field) or {}).get(task_id)
        if current:
            old_date = current
            task_column = column
            break
    overrides = event.get("task_overrides", {})
    previous_override = overrides.get(task_id, {}) or {}
    if "assignee" in data:
        data["assignee"] = normalize_assignee(data.get("assignee"))
    overrides[task_id] = {**previous_override, **{k: v for k, v in data.items() if k in ("color", "icon", "title", "assignee", "order")}}
    update = {"task_overrides": overrides}
    # Update date in smm_tasks, reminders, or marketing_tasks if provided
    new_date = data.get("date")
    if new_date:
        if task_id in (event.get("smm_tasks") or {}):
            update[f"smm_tasks.{task_id}"] = new_date
        elif task_id in (event.get("reminders") or {}):
            update[f"reminders.{task_id}"] = new_date
        elif task_id in (event.get("marketing_tasks") or {}):
            update[f"marketing_tasks.{task_id}"] = new_date
    await db.events.update_one({"id": event_id}, {"$set": update})

async def _delete_event_task_instance(event_id: str, task_id: str):
    """Remove an event-based task instance from its event maps."""
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    unset_fields = {}
    for field in COLUMN_TO_FIELD.values():
        if task_id in (event.get(field) or {}):
            unset_fields[f"{field}.{task_id}"] = ""
    for field in COLUMN_TO_COMPLETED_FIELD.values():
        if task_id in (event.get(field) or {}):
            unset_fields[f"{field}.{task_id}"] = ""
    if task_id in (event.get("task_overrides") or {}):
        unset_fields[f"task_overrides.{task_id}"] = ""

    if not unset_fields:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.events.update_one({"id": event_id}, {"$unset": unset_fields})
    return {"deleted": True, "event_id": event_id, "task_id": task_id}


@api_router.delete("/events/{event_id}/tasks/{task_id}")
async def delete_event_task(event_id: str, task_id: str):
    return await _delete_event_task_instance(event_id, task_id)


@api_router.post("/events/{event_id}/tasks/{task_id}/delete")
async def delete_event_task_post_fallback(event_id: str, task_id: str):
    return await _delete_event_task_instance(event_id, task_id)


@api_router.get("/smm/announcement-overlaps")
async def get_announcement_overlaps():
    """Check for announcement task overlaps across all events.
    Returns dates that have announcements from multiple events."""
    events = await db.events.find(
        {"cancelled": {"$ne": True}, "archived": {"$ne": True}},
        {"_id": 0}
    ).to_list(1000)
    
    # Collect all announcement dates per event
    announcement_dates = {}  # date -> [{event_id, event_title, task_id, task_name}]
    
    for event in events:
        smm_tasks = event.get("smm_tasks", {})
        for task_def in SMM_TASKS:
            if task_def.get("is_announcement") and task_def["id"] in smm_tasks:
                task_date = smm_tasks[task_def["id"]]
                if task_date not in announcement_dates:
                    announcement_dates[task_date] = []
                announcement_dates[task_date].append({
                    "event_id": event["id"],
                    "event_title": event.get("title", ""),
                    "task_id": task_def["id"],
                    "task_name": task_def["name"],
                })
    
    # Only return dates with 2+ announcements from different events
    overlaps = {}
    for date, tasks in announcement_dates.items():
        unique_events = set(t["event_id"] for t in tasks)
        if len(unique_events) >= 2:
            overlaps[date] = tasks
    
    return overlaps


# ==================== AI EVENT PARSING ====================

@api_router.post("/events/parse", response_model=ParseEventResponse)
async def parse_events_with_ai(request: ParseEventRequest):
    """Parse natural language text to extract event details using AI"""
    from openai import AsyncOpenAI
    import json

    emergent_key = os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("OPENAI_API_KEY")
    if not emergent_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    today = datetime.now().strftime("%Y-%m-%d")
    current_year = datetime.now().year

    system_prompt = f"""Ти - асистент для парсингу інформації про події з тексту українською мовою.
Сьогоднішня дата: {today}
Поточний рік: {current_year}

Твоя задача - витягнути з тексту інформацію про події та повернути її у форматі JSON.

Для кожної події потрібно витягнути:
- title: назва події
- date: дата у форматі YYYY-MM-DD (якщо рік не вказано, використовуй {current_year} або {current_year + 1} якщо дата вже минула)
- price: ціна в гривнях (число, без валюти). Якщо не вказано - 0
- spots: кількість місць/учасників (число). Якщо не вказано - 10
- description: короткий опис (якщо є)
- start_time: час початку у форматі HH:MM (24-годинний формат). Якщо не вказано - ""
- end_time: час закінчення у форматі HH:MM (24-годинний формат). Якщо не вказано - "" (якщо вказано тільки початок, можна залишити пустим)

Відповідай ТІЛЬКИ валідним JSON у форматі:
{{
  "events": [
    {{
      "title": "Назва",
      "date": "2026-02-15",
      "price": 500,
      "spots": 20,
      "description": "Опис",
      "start_time": "19:00",
      "end_time": "22:00"
    }}
  ],
  "clarification_needed": false,
  "clarification_message": ""
}}

Якщо чогось важливого бракує (дата або назва), встанови clarification_needed: true та напиши clarification_message українською, що саме потрібно уточнити.

Якщо в тексті кілька подій - розпарси всі."""

    try:
        client = AsyncOpenAI(api_key=emergent_key)
        completion = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.text}
            ]
        )
        response = completion.choices[0].message.content
        
        # Clean response - remove markdown code blocks if present
        response_text = response.strip()
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
        
        parsed = json.loads(response_text)
        
        # Validate and add missing_fields
        events = []
        for ev in parsed.get("events", []):
            missing = []
            if not ev.get("title"):
                missing.append("назва")
            if not ev.get("date"):
                missing.append("дата")
            
            events.append(ParsedEvent(
                title=ev.get("title", ""),
                date=ev.get("date", ""),
                price=float(ev.get("price", 0)),
                spots=int(ev.get("spots", 10)),
                description=ev.get("description", ""),
                missing_fields=missing,
                confidence=0.9 if not missing else 0.5
            ))
        
        return ParseEventResponse(
            events=events,
            clarification_needed=parsed.get("clarification_needed", False),
            clarification_message=parsed.get("clarification_message", "")
        )
        
    except json.JSONDecodeError as e:
        logging.error(f"Failed to parse AI response: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        logging.error(f"AI parsing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/smm/tasks-definition")
async def get_smm_tasks_definition():
    """Return all task definitions (with overrides applied) for frontend use."""
    return {
        "management": get_tasks_for_column("management"),
        "smm":        get_tasks_for_column("smm"),
        "marketing":  get_tasks_for_column("marketing"),
        "monthly":    get_tasks_for_column("monthly"),
        "daily":      DAILY_TASKS,
    }


# ==================== TASK DEFINITIONS — manual edits ====================

EDITABLE_FIELDS = {"name", "days_before", "column", "is_announcement", "is_teamwork", "series_master_only", "condition", "frequency"}

def _find_base_task(task_id: str):
    """Locate a hardcoded task by id; return (task_dict, column_name) or (None, None)."""
    for col, lst in (("management", MANAGEMENT_TASKS), ("smm", SMM_TASKS),
                      ("marketing", MARKETING_TASKS), ("monthly", MONTHLY_TASKS)):
        for t in lst:
            if t["id"] == task_id:
                return t, col
    return None, None


async def _adapt_events_to_definition_change(task_id: str, before: dict, after: dict, was_deleted: bool):
    """Propagate a task-definition change to all existing events.

    Cases:
      - was_deleted=True → strip task_id from every event's reminders/smm_tasks/marketing_tasks
      - column changed → move task entry from old column field to new
      - days_before changed → recompute date for FUTURE events only
    """
    fields_by_col = {"management": "reminders", "smm": "smm_tasks", "marketing": "marketing_tasks"}
    today_str = datetime.now(timezone.utc).date().isoformat()

    if was_deleted:
        for fld in fields_by_col.values():
            await db.events.update_many({}, {"$unset": {f"{fld}.{task_id}": ""}})
        return

    old_col = (before or {}).get("column")
    new_col = (after or {}).get("column", old_col)
    old_days = (before or {}).get("days_before")
    new_days = (after or {}).get("days_before", old_days)

    # If column changed: move the entry from the old field to the new one
    if old_col and new_col and old_col != new_col:
        old_field = fields_by_col.get(old_col)
        new_field = fields_by_col.get(new_col)
        if old_field and new_field:
            cursor = db.events.find({f"{old_field}.{task_id}": {"$exists": True}}, {"_id": 0})
            async for ev in cursor:
                date_val = (ev.get(old_field) or {}).get(task_id)
                if not date_val:
                    continue
                await db.events.update_one(
                    {"id": ev["id"]},
                    {"$set":   {f"{new_field}.{task_id}": date_val},
                     "$unset": {f"{old_field}.{task_id}": ""}},
                )

    # If days_before changed: recompute date for future events
    if old_days != new_days and new_days is not None:
        target_col = new_col or old_col
        target_field = fields_by_col.get(target_col)
        if not target_field:
            return
        cursor = db.events.find({f"{target_field}.{task_id}": {"$exists": True}, "date": {"$gte": today_str}}, {"_id": 0})
        async for ev in cursor:
            try:
                ev_dt = datetime.strptime(ev["date"][:10], "%Y-%m-%d").date()
            except Exception:
                continue
            new_date = (ev_dt - timedelta(days=int(new_days))).isoformat()
            await db.events.update_one(
                {"id": ev["id"]},
                {"$set": {f"{target_field}.{task_id}": new_date}},
            )


@api_router.patch("/task-definitions/{task_id}")
async def edit_task_definition(task_id: str, payload: dict):
    """Edit a task definition. Stores diff vs hardcoded default. Each call
    appends previous patch to history (so we can revert)."""
    base, base_col = _find_base_task(task_id)
    existing = await db.task_definition_overrides.find_one({"task_id": task_id}, {"_id": 0})

    # If brand-new task — just merge fields into full_definition
    if not base:
        if not existing or not existing.get("is_new"):
            raise HTTPException(status_code=404, detail="Unknown task id")
        full = existing.get("full_definition") or {}
        new_full = {**full, **{k: v for k, v in payload.items() if k in EDITABLE_FIELDS}}
        history = list(existing.get("history") or [])
        history.append({"changed_at": datetime.now(timezone.utc).isoformat(), "previous_full": full})
        await db.task_definition_overrides.update_one(
            {"task_id": task_id},
            {"$set": {"full_definition": new_full, "history": history,
                       "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        await _refresh_task_overrides_cache()
        await _adapt_events_to_definition_change(task_id, full, new_full, False)
        return {"task_id": task_id, "applied": new_full}

    # Hardcoded task — apply diff
    fields = {k: v for k, v in payload.items() if k in EDITABLE_FIELDS}
    if not fields:
        raise HTTPException(status_code=400, detail="No editable fields supplied")
    prior_patch = (existing or {}).get("patch") or {}
    new_patch = {**prior_patch, **fields}

    # Compute before/after for adaptation
    before_eff = {**base, **prior_patch}
    after_eff = {**base, **new_patch}

    history = list((existing or {}).get("history") or [])
    history.append({"changed_at": datetime.now(timezone.utc).isoformat(), "previous_patch": prior_patch})

    doc = {
        "task_id": task_id,
        "column": base_col,
        "patch": new_patch,
        "is_deleted": False,
        "is_new": False,
        "history": history,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.task_definition_overrides.update_one(
        {"task_id": task_id}, {"$set": doc, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": doc["updated_at"]}}, upsert=True,
    )
    await _refresh_task_overrides_cache()
    await _adapt_events_to_definition_change(task_id, before_eff, after_eff, False)
    return {"task_id": task_id, "patch": new_patch}


@api_router.delete("/task-definitions/{task_id}")
async def delete_task_definition(task_id: str):
    """Soft-delete a hardcoded task (override flag) or hard-delete a brand-new task."""
    base, base_col = _find_base_task(task_id)
    existing = await db.task_definition_overrides.find_one({"task_id": task_id}, {"_id": 0})

    if not base:
        # Brand-new task — actually remove the row
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")
        await db.task_definition_overrides.delete_one({"task_id": task_id})
        await _refresh_task_overrides_cache()
        await _adapt_events_to_definition_change(task_id, None, None, True)
        return {"task_id": task_id, "deleted": True}

    # Hardcoded task — set is_deleted=True
    history = list((existing or {}).get("history") or [])
    history.append({"changed_at": datetime.now(timezone.utc).isoformat(),
                     "previous_patch": (existing or {}).get("patch") or {},
                     "previously_deleted": (existing or {}).get("is_deleted", False)})
    doc = {
        "task_id": task_id,
        "column": base_col,
        "patch": (existing or {}).get("patch") or {},
        "is_deleted": True,
        "is_new": False,
        "history": history,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.task_definition_overrides.update_one(
        {"task_id": task_id}, {"$set": doc, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": doc["updated_at"]}}, upsert=True,
    )
    await _refresh_task_overrides_cache()
    await _adapt_events_to_definition_change(task_id, None, None, True)
    return {"task_id": task_id, "deleted": True}


@api_router.post("/task-definitions")
async def create_task_definition(payload: dict):
    """Create a brand-new task definition (no hardcoded counterpart).

    payload accepts:
      frequency: "event" (default) | "monthly" | "daily"
      column:    "management" | "smm" | "marketing" — assignee
      name, days_before, condition, is_announcement, is_teamwork, series_master_only
    """
    name = payload.get("name")
    column = payload.get("column")  # assignee
    frequency = payload.get("frequency", "event")
    if not name or not column:
        raise HTTPException(status_code=400, detail="name + column (assignee) required")
    if column not in ("management", "smm", "marketing"):
        raise HTTPException(status_code=400, detail="invalid column (must be management/smm/marketing)")
    if frequency not in ("event", "monthly", "daily"):
        raise HTTPException(status_code=400, detail="invalid frequency")

    new_id = payload.get("id") or f"custom_{uuid.uuid4().hex[:10]}"
    full = {
        "id": new_id,
        "name": name,
        "days_before": int(payload.get("days_before", 0)) if frequency != "daily" else 0,
        "column": column,
        "frequency": frequency,
        "condition": payload.get("condition") if frequency == "event" else None,
        "is_announcement": bool(payload.get("is_announcement", False)) if frequency == "event" else False,
        "is_teamwork": bool(payload.get("is_teamwork", False)),
        "series_master_only": bool(payload.get("series_master_only", False)) if frequency == "event" else False,
        "weight": float(payload.get("weight", 0.1)),
        "shift_kind": payload.get("shift_kind", "easy"),
    }
    doc = {
        "id": str(uuid.uuid4()),
        "task_id": new_id,
        "column": column,
        "frequency": frequency,
        "patch": {},
        "is_deleted": False,
        "is_new": True,
        "full_definition": full,
        "history": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.task_definition_overrides.insert_one(doc)
    await _refresh_task_overrides_cache()
    return {"task_id": new_id, "definition": full}


@api_router.post("/task-definitions/{task_id}/revert")
async def revert_task_definition(task_id: str):
    """Pop the last history entry → restore previous patch (or undelete)."""
    existing = await db.task_definition_overrides.find_one({"task_id": task_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="No override to revert")
    history = list(existing.get("history") or [])
    if not history:
        # Nothing to revert to — remove override entirely (back to hardcoded default)
        await db.task_definition_overrides.delete_one({"task_id": task_id})
        await _refresh_task_overrides_cache()
        return {"task_id": task_id, "reverted_to": "hardcoded_default"}
    last = history.pop()
    update = {"history": history, "updated_at": datetime.now(timezone.utc).isoformat()}
    if "previous_patch" in last:
        update["patch"] = last["previous_patch"]
        update["is_deleted"] = last.get("previously_deleted", False)
    if "previous_full" in last:
        update["full_definition"] = last["previous_full"]
    await db.task_definition_overrides.update_one({"task_id": task_id}, {"$set": update})
    await _refresh_task_overrides_cache()
    return {"task_id": task_id, "reverted": True}


@api_router.get("/task-definitions/overrides")
async def list_task_definition_overrides():
    """Inspect all manual overrides (debug / audit)."""
    docs = await db.task_definition_overrides.find({}, {"_id": 0}).to_list(2000)
    return {"count": len(docs), "overrides": docs}


@api_router.get("/monthly-tasks")
async def get_monthly_tasks(year: int = None, month: int = None):
    """Get monthly auto-tasks for a specific month."""
    now = datetime.now(timezone.utc)
    if not year:
        year = now.year
    if not month:
        month = now.month
    return calculate_monthly_tasks(year, month)


@api_router.post("/monthly-tasks/generate")
async def generate_monthly_tasks(year: int = None, month: int = None):
    """Generate monthly tasks as standalone tasks in DB for a given target month.
    Tasks are created only once per month (idempotent)."""
    now = datetime.now(timezone.utc)
    if not year:
        year = now.year
    if not month:
        month = now.month
    
    month_key = f"{year}-{str(month).zfill(2)}"
    month_name = UK_MONTHS_NOMINATIVE_PY.get(month, str(month))
    
    # Check if already generated for this month
    existing = await db.generated_months.find_one({"month_key": month_key}, {"_id": 0})
    if existing:
        return {"status": "already_generated", "month": month_key, "count": existing.get("count", 0)}
    
    calculated = calculate_monthly_tasks(year, month)
    created = 0
    column_to_assignee = {"management": "manager", "smm": "smm", "marketing": "marketer"}
    
    for task_id, task_info in calculated.items():
        assignee = column_to_assignee.get(task_info["column"], "manager")
        standalone = {
            "id": f"monthly-{month_key}-{task_id}",
            "title": task_info["name"],
            "date": task_info["date"],
            "icon": "calendar",
            "type": "monthly",
            "color": "standard",
            "assignee": assignee,
            "completed": False,
            "completed_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "monthly_source": task_id,
            "target_month": month_key,
        }
        # Upsert to avoid duplicates
        await db.standalone_tasks.update_one(
            {"id": standalone["id"]},
            {"$setOnInsert": standalone},
            upsert=True
        )
        created += 1
    
    # Mark month as generated
    await db.generated_months.update_one(
        {"month_key": month_key},
        {"$set": {"month_key": month_key, "generated_at": datetime.now(timezone.utc).isoformat(), "count": created}},
        upsert=True
    )
    
    return {"status": "generated", "month": month_key, "count": created}


@api_router.get("/monthly-tasks/status")
async def monthly_tasks_status():
    """Check which months have been generated."""
    docs = await db.generated_months.find({}, {"_id": 0}).to_list(100)
    return docs


@api_router.put("/smm/tasks-definition/{task_id}")
async def update_smm_task_definition(task_id: str, update_data: SMMTaskUpdate):
    """Update a single SMM task definition"""
    # First, ensure we have custom tasks in DB
    existing = await db.smm_tasks_definition.find({}, {"_id": 0}).to_list(100)
    if not existing:
        # Copy default tasks to DB
        for task in SMM_TASKS:
            await db.smm_tasks_definition.insert_one(task.copy())
    
    # Now update the specific task
    update_dict = {k: v for k, v in update_data.model_dump().items() if v is not None}
    if not update_dict:
        return {"message": "No changes"}
    
    result = await db.smm_tasks_definition.update_one(
        {"id": task_id},
        {"$set": update_dict}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return {"message": "Task updated successfully"}

@api_router.get("/all-task-types")
async def get_all_task_types():
    """Return all task types - both regular reminders and SMM tasks"""
    settings = await get_settings()
    
    regular_tasks = [
        {
            "id": rt.id,
            "name": rt.name,
            "days_before": rt.days_before,
            "icon": rt.icon,
            "type": "reminder",
            "is_posting": False
        }
        for rt in settings.reminder_types
    ]
    
    smm_tasks = [
        {
            "id": t["id"],
            "name": t["name"],
            "days_before": t["days_before"],
            "icon": "send",
            "type": "smm",
            "is_posting": t["is_posting"]
        }
        for t in SMM_TASKS
    ]
    
    return {
        "reminder_tasks": regular_tasks,
        "smm_tasks": smm_tasks
    }

@api_router.get("/tasks/archive")
async def get_task_archive():
    events = await db.events.find({}, {"_id": 0}).to_list(1000)
    settings = await get_settings()
    
    archive = []
    reminder_map = {rt.id: rt for rt in settings.reminder_types}
    
    for event in events:
        completed_tasks = event.get("completed_tasks", {})
        for reminder_id, completed_at in completed_tasks.items():
            reminder_info = reminder_map.get(reminder_id)
            if reminder_info:
                archive.append({
                    "event_id": event["id"],
                    "event_title": event["title"],
                    "event_date": event["date"],
                    "reminder_id": reminder_id,
                    "reminder_name": reminder_info.name,
                    "completed_at": completed_at
                })
    
    # Add standalone tasks
    standalone = await db.standalone_tasks.find({"completed": True}, {"_id": 0}).to_list(1000)
    for task in standalone:
        archive.append({
            "event_id": task["id"],
            "event_title": task["title"],
            "event_date": task["date"],
            "reminder_id": "standalone",
            "reminder_name": "завдання",
            "completed_at": task.get("completed_at", task["created_at"]),
            "is_standalone": True
        })
    
    archive.sort(key=lambda x: x["completed_at"], reverse=True)
    return archive

# ==================== SETTINGS API ====================

@api_router.get("/settings", response_model=Settings)
async def get_settings_endpoint():
    return await get_settings()

@api_router.put("/settings", response_model=Settings)
async def update_settings(settings_data: dict):
    current = await get_settings()
    
    if "altegio_service_mappings" in settings_data:
        mappings = {**DEFAULT_ALTEGIO_SERVICE_MAPPINGS}
        for key, value in (settings_data.get("altegio_service_mappings") or {}).items():
            try:
                mappings[str(key)] = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Invalid Altegio service id for {key}")
        await db.settings.update_one(
            {"id": "global_settings"},
            {"$set": {"altegio_service_mappings": mappings}},
            upsert=True,
        )

    if "reminder_types" in settings_data:
        new_reminders = []
        for rt in settings_data["reminder_types"]:
            if "id" not in rt or not rt["id"]:
                rt["id"] = str(uuid.uuid4())
            new_reminders.append(ReminderType(**rt))
        
        # Sort by days_before
        new_reminders.sort(key=lambda x: x.days_before, reverse=True)
        
        await db.settings.update_one(
            {"id": "global_settings"},
            {"$set": {"reminder_types": [r.model_dump() for r in new_reminders]}}
        )
        
        events = await db.events.find({}, {"_id": 0}).to_list(1000)
        
        # Bulk update all events
        if events:
            operations = []
            for event in events:
                reminders = calculate_reminder_dates(event["date"], new_reminders)
                completed_tasks = event.get("completed_tasks", {})
                valid_completed = {k: v for k, v in completed_tasks.items() 
                                if k in [r.id for r in new_reminders]}
                operations.append(UpdateOne(
                    {"id": event["id"]},
                    {"$set": {"reminders": reminders, "completed_tasks": valid_completed}}
                ))
            if operations:
                await db.events.bulk_write(operations)
    
    return await get_settings()


@api_router.patch("/settings/task/{task_id}")
async def update_task_definition(task_id: str, data: dict):
    """Update a single task's name and days_before in settings."""
    settings = await get_settings()
    updated = False
    
    for rt in settings.reminder_types:
        if rt.id == task_id:
            if "name" in data:
                rt.name = data["name"]
            if "days_before" in data:
                rt.days_before = int(data["days_before"])
            updated = True
            break
    
    if updated:
        new_reminders = sorted(settings.reminder_types, key=lambda x: x.days_before, reverse=True)
        await db.settings.update_one(
            {"id": "global_settings"},
            {"$set": {"reminder_types": [r.model_dump() for r in new_reminders]}}
        )
        events = await db.events.find({}, {"_id": 0}).to_list(1000)
        if events:
            operations = []
            for event in events:
                reminders = calculate_reminder_dates(event["date"], new_reminders)
                operations.append(UpdateOne({"id": event["id"]}, {"$set": {"reminders": reminders}}))
            if operations:
                await db.events.bulk_write(operations)
        return {"success": True}
    
    return {"success": False, "detail": "task not found in editable settings"}


@api_router.post("/settings/reminders")
async def add_reminder_type(reminder: dict):
    current = await get_settings()
    
    new_reminder = ReminderType(
        name=reminder.get("name", "нове нагадування"),
        days_before=reminder.get("days_before", 7),
        icon=reminder.get("icon", "bell")
    )
    
    reminder_types = current.reminder_types + [new_reminder]
    reminder_types.sort(key=lambda x: x.days_before, reverse=True)
    
    await db.settings.update_one(
        {"id": "global_settings"},
        {"$set": {"reminder_types": [r.model_dump() for r in reminder_types]}}
    )
    
    events = await db.events.find({}, {"_id": 0}).to_list(1000)
    
    # Bulk update all events with new reminder
    if events:
        operations = []
        for event in events:
            reminders = calculate_reminder_dates(event["date"], reminder_types)
            operations.append(UpdateOne(
                {"id": event["id"]},
                {"$set": {"reminders": reminders}}
            ))
        if operations:
            await db.events.bulk_write(operations)
    
    return await get_settings()

@api_router.put("/settings/reminders/{reminder_id}")
async def update_reminder_type(reminder_id: str, reminder: dict):
    current = await get_settings()
    
    updated_reminders = []
    for rt in current.reminder_types:
        if rt.id == reminder_id:
            updated_reminders.append(ReminderType(
                id=reminder_id,
                name=reminder.get("name", rt.name),
                days_before=reminder.get("days_before", rt.days_before),
                icon=reminder.get("icon", rt.icon)
            ))
        else:
            updated_reminders.append(rt)
    
    updated_reminders.sort(key=lambda x: x.days_before, reverse=True)
    
    await db.settings.update_one(
        {"id": "global_settings"},
        {"$set": {"reminder_types": [r.model_dump() for r in updated_reminders]}}
    )
    
    events = await db.events.find({}, {"_id": 0}).to_list(1000)
    
    # Bulk update all events with updated reminder
    if events:
        operations = []
        for event in events:
            reminders = calculate_reminder_dates(event["date"], updated_reminders)
            operations.append(UpdateOne(
                {"id": event["id"]},
                {"$set": {"reminders": reminders}}
            ))
        if operations:
            await db.events.bulk_write(operations)
    
    return await get_settings()

@api_router.delete("/settings/reminders/{reminder_id}")
async def delete_reminder_type(reminder_id: str):
    current = await get_settings()
    
    reminder_types = [r for r in current.reminder_types if r.id != reminder_id]
    
    await db.settings.update_one(
        {"id": "global_settings"},
        {"$set": {"reminder_types": [r.model_dump() for r in reminder_types]}}
    )
    
    # Use $unset to remove reminder from all events in one operation
    await db.events.update_many(
        {},
        {"$unset": {f"reminders.{reminder_id}": "", f"completed_tasks.{reminder_id}": ""}}
    )
    
    return await get_settings()

# ==================== STATISTICS API ====================

@api_router.get("/statistics")
async def get_statistics():
    # Exclude archived events from statistics
    events = await db.events.find({"archived": {"$ne": True}}, {"_id": 0}).to_list(1000)
    settings = await get_settings()
    
    today = datetime.now(timezone.utc).date()
    
    monthly_stats = {}
    
    for event in events:
        try:
            event_date = datetime.fromisoformat(event["date"].replace('Z', '+00:00')).date()
        except:
            event_date = datetime.strptime(event["date"][:10], '%Y-%m-%d').date()
        
        month_key = event_date.strftime("%Y-%m")
        
        if month_key not in monthly_stats:
            monthly_stats[month_key] = {
                "month": month_key,
                "events_count": 0,
                "cancelled_count": 0,
                "planned_revenue": 0,
                "total_deadlines": 0,
                "completed_deadlines": 0,
            }
        
        stats = monthly_stats[month_key]
        stats["events_count"] += 1
        
        if event.get("cancelled"):
            stats["cancelled_count"] += 1
        else:
            stats["planned_revenue"] += event.get("price", 0) * event.get("spots", 10)
        
        # Calculate deadline compliance
        reminders = event.get("reminders", {})
        completed_tasks = event.get("completed_tasks", {})
        
        for reminder_id, reminder_date_str in reminders.items():
            stats["total_deadlines"] += 1
            reminder_date = datetime.strptime(reminder_date_str[:10], '%Y-%m-%d').date()
            
            if reminder_id in completed_tasks:
                completed_at = datetime.fromisoformat(completed_tasks[reminder_id].replace('Z', '+00:00')).date()
                if completed_at <= reminder_date:
                    stats["completed_deadlines"] += 1
            elif reminder_date >= today:
                # Not yet due
                stats["completed_deadlines"] += 1
    
    # Calculate percentages and badges
    result = []
    
    for month_key in sorted(monthly_stats.keys()):
        stats = monthly_stats[month_key]
        
        # Calculate missed deadlines percentage
        missed_deadlines_percent = 0
        if stats["total_deadlines"] > 0:
            missed = stats["total_deadlines"] - stats["completed_deadlines"]
            missed_deadlines_percent = round((missed / stats["total_deadlines"]) * 100)
        
        badges = []
        if missed_deadlines_percent == 0:
            badges.append("perfect")
        elif missed_deadlines_percent <= 10:
            badges.append("excellent")
        
        result.append({
            "month": month_key,
            "events_count": stats["events_count"],
            "cancelled_count": stats["cancelled_count"],
            "planned_revenue": stats["planned_revenue"],
            "missed_deadlines_percent": missed_deadlines_percent,
            "badges": badges
        })
    
    return result

# ==================== GOOGLE CALENDAR EXPORT ====================

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar"]

def get_google_redirect_uri():
    """Get redirect URI based on environment - must point to BACKEND (where the /api/ routes live)"""
    # GOOGLE_REDIRECT_URI takes precedence if explicitly set
    if os.environ.get("GOOGLE_REDIRECT_URI"):
        return os.environ.get("GOOGLE_REDIRECT_URI")
    # BACKEND_URL is the Railway backend service URL
    backend_url = os.environ.get("BACKEND_URL", "https://sensa-management-tool-production.up.railway.app")
    return f"{backend_url}/api/oauth/calendar/callback"

@api_router.get("/oauth/calendar/login")
async def google_calendar_login():
    """Start Google Calendar OAuth flow"""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google Calendar not configured")
    
    redirect_uri = get_google_redirect_uri()
    
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent"
    }
    
    import urllib.parse
    auth_url = f"https://accounts.google.com/o/oauth2/auth?{urllib.parse.urlencode(params)}"
    
    return {"authorization_url": auth_url}

@api_router.get("/oauth/calendar/callback")
async def google_calendar_callback(code: str = None, error: str = None):
    """Handle Google OAuth callback"""
    if error:
        frontend_url = os.environ.get("FRONTEND_URL", "https://task-hub-890.preview.emergentagent.com")
        return RedirectResponse(f"{frontend_url}/settings?error={error}")
    
    if not code:
        raise HTTPException(status_code=400, detail="No authorization code")
    
    redirect_uri = get_google_redirect_uri()
    
    # Exchange code for tokens
    token_resp = requests.post('https://oauth2.googleapis.com/token', data={
        'code': code,
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code'
    }).json()
    
    if 'error' in token_resp:
        logging.error(f"Token exchange error: {token_resp}")
        frontend_url = os.environ.get("FRONTEND_URL", "https://task-hub-890.preview.emergentagent.com")
        return RedirectResponse(f"{frontend_url}/settings?error=token_exchange_failed")
    
    # Get user info
    user_info = requests.get(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        headers={'Authorization': f'Bearer {token_resp["access_token"]}'}
    ).json()
    
    # Save tokens in settings
    await db.google_calendar.update_one(
        {"type": "google_calendar_tokens"},
        {"$set": {
            "access_token": token_resp.get("access_token"),
            "refresh_token": token_resp.get("refresh_token"),
            "email": user_info.get("email"),
            "connected_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    
    # Redirect to home page with success param
    frontend_url = os.environ.get("FRONTEND_URL", "https://task-hub-890.preview.emergentagent.com")
    return RedirectResponse(f"{frontend_url}/?google_connected=true")

@api_router.get("/oauth/calendar/status")
async def google_calendar_status():
    """Check if Google Calendar is connected and token is valid"""
    tokens = await db.google_calendar.find_one({"type": "google_calendar_tokens"}, {"_id": 0})
    
    if not tokens or not tokens.get("refresh_token"):
        return {"connected": False}
    
    # Try to validate the token by refreshing it
    try:
        refresh_response = requests.post('https://oauth2.googleapis.com/token', data={
            'client_id': GOOGLE_CLIENT_ID,
            'client_secret': GOOGLE_CLIENT_SECRET,
            'refresh_token': tokens.get('refresh_token'),
            'grant_type': 'refresh_token'
        }).json()
        
        if 'error' in refresh_response:
            # Token is invalid
            if refresh_response.get('error') == 'invalid_grant':
                await db.google_calendar.delete_one({"type": "google_calendar_tokens"})
            return {"connected": False, "error": "token_expired"}
        
        # Update access token
        new_access_token = refresh_response.get('access_token')
        if new_access_token:
            await db.google_calendar.update_one(
                {"type": "google_calendar_tokens"},
                {"$set": {"access_token": new_access_token}}
            )
        
        return {
            "connected": True,
            "email": tokens.get("email"),
            "connected_at": tokens.get("connected_at")
        }
        
    except Exception as e:
        logging.error(f"Error checking Google Calendar status: {e}")
        return {"connected": False, "error": str(e)}

@api_router.post("/oauth/calendar/disconnect")
async def google_calendar_disconnect():
    """Disconnect Google Calendar"""
    await db.google_calendar.delete_one({"type": "google_calendar_tokens"})
    return {"success": True}

async def get_google_credentials():
    """Get Google credentials with auto-refresh"""
    tokens = await db.google_calendar.find_one({"type": "google_calendar_tokens"}, {"_id": 0})
    
    if not tokens or not tokens.get("refresh_token"):
        logging.warning("No Google Calendar tokens or refresh_token found")
        return None
    
    # Always try to refresh the token to ensure it's valid
    try:
        refresh_response = requests.post('https://oauth2.googleapis.com/token', data={
            'client_id': GOOGLE_CLIENT_ID,
            'client_secret': GOOGLE_CLIENT_SECRET,
            'refresh_token': tokens.get('refresh_token'),
            'grant_type': 'refresh_token'
        }).json()
        
        if 'error' in refresh_response:
            logging.error(f"Failed to refresh Google token: {refresh_response}")
            # Token is invalid, clear it
            if refresh_response.get('error') == 'invalid_grant':
                await db.google_calendar.delete_one({"type": "google_calendar_tokens"})
                logging.info("Cleared invalid Google Calendar tokens")
            return None
        
        new_access_token = refresh_response.get('access_token')
        if new_access_token:
            # Update stored access token
            await db.google_calendar.update_one(
                {"type": "google_calendar_tokens"},
                {"$set": {"access_token": new_access_token}}
            )
            
            creds = Credentials(
                token=new_access_token,
                refresh_token=tokens.get('refresh_token'),
                token_uri='https://oauth2.googleapis.com/token',
                client_id=GOOGLE_CLIENT_ID,
                client_secret=GOOGLE_CLIENT_SECRET
            )
            return creds
        
    except Exception as e:
        logging.error(f"Error refreshing Google token: {e}")
    
    return None

@api_router.post("/calendar/events/{event_id}/export")
async def export_event_to_google_calendar(event_id: str):
    """Export a single event to Google Calendar"""
    creds = await get_google_credentials()
    if not creds:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    try:
        service = build('calendar', 'v3', credentials=creds)
        
        # Parse event date
        try:
            event_date = datetime.fromisoformat(event["date"].replace('Z', '+00:00'))
        except:
            event_date = datetime.strptime(event["date"][:10], '%Y-%m-%d')
        
        # Check if we have start_time and end_time
        start_time = event.get('start_time', '')
        end_time = event.get('end_time', '')
        
        # Create Google Calendar event
        calendar_event = {
            'summary': event['title'],
            'description': f"{event.get('description', '')}\n\nціна: {event['price']} грн\nмісць: {event.get('spots', 10)}",
        }
        
        if start_time and end_time:
            # Timed event with start and end time
            date_str = event_date.strftime('%Y-%m-%d')
            calendar_event['start'] = {
                'dateTime': f"{date_str}T{start_time}:00",
                'timeZone': 'Europe/Kyiv'
            }
            calendar_event['end'] = {
                'dateTime': f"{date_str}T{end_time}:00",
                'timeZone': 'Europe/Kyiv'
            }
        elif start_time:
            # Only start time - use 3 hour default duration
            date_str = event_date.strftime('%Y-%m-%d')
            start_hour, start_min = map(int, start_time.split(':'))
            end_hour = (start_hour + 3) % 24
            default_end = f"{end_hour:02d}:{start_min:02d}"
            calendar_event['start'] = {
                'dateTime': f"{date_str}T{start_time}:00",
                'timeZone': 'Europe/Kyiv'
            }
            calendar_event['end'] = {
                'dateTime': f"{date_str}T{default_end}:00",
                'timeZone': 'Europe/Kyiv'
            }
        else:
            # All-day event (no time specified)
            calendar_event['start'] = {
                'date': event_date.strftime('%Y-%m-%d'),
                'timeZone': 'Europe/Kyiv'
            }
            calendar_event['end'] = {
                'date': (event_date + timedelta(days=1)).strftime('%Y-%m-%d'),
                'timeZone': 'Europe/Kyiv'
            }
        
        result = service.events().insert(calendarId='primary', body=calendar_event).execute()
        
        # Save Google Calendar event ID
        await db.events.update_one(
            {"id": event_id},
            {"$set": {"google_calendar_event_id": result.get("id"), "google_calendar_id": result.get("id")}}
        )
        
        return {
            "success": True,
            "google_event_id": result.get("id"),
            "html_link": result.get("htmlLink")
        }
        
    except Exception as e:
        logging.error(f"Failed to export to Google Calendar: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/calendar/export-all")
async def export_all_events_to_google_calendar():
    """Export all future events to Google Calendar"""
    creds = await get_google_credentials()
    if not creds:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    
    today = datetime.now(timezone.utc).date()
    events = await db.events.find({}, {"_id": 0}).to_list(1000)
    
    # Filter future events that are not cancelled
    future_events = [
        e for e in events 
        if not e.get("cancelled") and datetime.strptime(e["date"][:10], '%Y-%m-%d').date() >= today
    ]
    
    if not future_events:
        return {"success": True, "exported_count": 0, "message": "No future events to export"}
    
    try:
        service = build('calendar', 'v3', credentials=creds)
        exported = []
        
        for event in future_events:
            # Skip if already exported
            if _google_calendar_event_id(event):
                continue
            
            try:
                event_date = datetime.fromisoformat(event["date"].replace('Z', '+00:00'))
            except:
                event_date = datetime.strptime(event["date"][:10], '%Y-%m-%d')
            
            # Check if we have start_time and end_time
            start_time = event.get('start_time', '')
            end_time = event.get('end_time', '')
            
            calendar_event = {
                'summary': event['title'],
                'description': f"{event.get('description', '')}\n\nціна: {event['price']} грн\nмісць: {event.get('spots', 10)}",
            }
            
            if start_time and end_time:
                # Timed event with start and end time
                date_str = event_date.strftime('%Y-%m-%d')
                calendar_event['start'] = {
                    'dateTime': f"{date_str}T{start_time}:00",
                    'timeZone': 'Europe/Kyiv'
                }
                calendar_event['end'] = {
                    'dateTime': f"{date_str}T{end_time}:00",
                    'timeZone': 'Europe/Kyiv'
                }
            elif start_time:
                # Only start time - use 3 hour default duration
                date_str = event_date.strftime('%Y-%m-%d')
                start_hour, start_min = map(int, start_time.split(':'))
                end_hour = (start_hour + 3) % 24
                default_end = f"{end_hour:02d}:{start_min:02d}"
                calendar_event['start'] = {
                    'dateTime': f"{date_str}T{start_time}:00",
                    'timeZone': 'Europe/Kyiv'
                }
                calendar_event['end'] = {
                    'dateTime': f"{date_str}T{default_end}:00",
                    'timeZone': 'Europe/Kyiv'
                }
            else:
                # All-day event (no time specified)
                calendar_event['start'] = {
                    'date': event_date.strftime('%Y-%m-%d'),
                    'timeZone': 'Europe/Kyiv'
                }
                calendar_event['end'] = {
                    'date': (event_date + timedelta(days=1)).strftime('%Y-%m-%d'),
                    'timeZone': 'Europe/Kyiv'
                }
            
            result = service.events().insert(calendarId='primary', body=calendar_event).execute()
            
            await db.events.update_one(
                {"id": event["id"]},
                {"$set": {"google_calendar_id": result.get("id"), "google_calendar_event_id": result.get("id")}}
            )
            
            exported.append(event["title"])
        
        return {
            "success": True,
            "exported_count": len(exported),
            "events": exported
        }
        
    except Exception as e:
        logging.error(f"Failed to export events: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/events/{event_id}/google-calendar-url")
async def get_google_calendar_url(event_id: str):
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    try:
        event_date = datetime.fromisoformat(event["date"].replace('Z', '+00:00'))
    except:
        event_date = datetime.strptime(event["date"][:10], '%Y-%m-%d')
    
    date_str = event_date.strftime("%Y%m%d")
    end_date = (event_date + timedelta(days=1)).strftime("%Y%m%d")
    
    description = f"{event['description']}\n\nціна: {event['price']} грн\nмісць: {event.get('spots', 10)}"
    
    import urllib.parse
    
    params = {
        "action": "TEMPLATE",
        "text": event["title"],
        "dates": f"{date_str}/{end_date}",
        "details": description,
    }
    
    base_url = "https://calendar.google.com/calendar/render"
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    
    return {"url": url}


@api_router.get("/altegio/status")
async def altegio_status():
    """Check if Altegio is connected and V2 push is configured."""
    v2_configured = bool(ALTEGIO_PARTNER_TOKEN)
    return {
        "connected": bool(ALTEGIO_USER_TOKEN),
        "push_enabled": v2_configured,
        "push_user_token_configured": bool(ALTEGIO_PUSH_USER_TOKEN),
        "using_separate_push_user_token": bool(ALTEGIO_PUSH_USER_TOKEN and ALTEGIO_PUSH_USER_TOKEN != ALTEGIO_USER_TOKEN),
        "service_id": ALTEGIO_DEFAULT_SERVICE_ID or None,
        "staff_id": ALTEGIO_DEFAULT_STAFF_ID if v2_configured else None
    }




# ==================== ALTEGIO INTEGRATION ====================

@api_router.get("/events/{event_id}/altegio-url")
async def get_altegio_url(event_id: str):
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    company_id = os.environ.get("ALTEGIO_COMPANY_ID")
    
    if not company_id:
        return {
            "url": None, 
            "message": "Altegio не налаштовано. Додай ALTEGIO_COMPANY_ID.",
            "can_create": False
        }
    
    altegio_id = event.get("altegio_id") or event.get("altegio_activity_id")
    url = _altegio_activity_url(str(altegio_id) if altegio_id else None)
    return {
        "url": url,
        "activity_url": _altegio_activity_url(str(altegio_id)) if altegio_id else None,
        "altegio_id": str(altegio_id) if altegio_id else None,
        "message": "Відкриваю подію в Altegio." if altegio_id else "Відкриваю сторінку бронювання.",
        "can_create": False,
        "event_data": {
            "title": event["title"],
            "date": event["date"],
            "description": event["description"],
            "price": event["price"],
            "spots": event.get("spots", 10)
        }
    }

# ==================== ALTEGIO INTEGRATION ====================

class AltegioClient:
    """HTTP client for Altegio API"""
    
    def __init__(self):
        self.base_url = ALTEGIO_BASE_URL
        self.company_id = ALTEGIO_COMPANY_ID
        self.user_token = ALTEGIO_USER_TOKEN
        self.push_user_token = ALTEGIO_PUSH_USER_TOKEN
    
    def get_headers(self):
        """Get authorization headers for Altegio API"""
        return {
            "Authorization": f"Bearer {self.user_token}",
            "Accept": "application/vnd.api.v2+json",
            "Content-Type": "application/json"
        }
    
    async def get_records(self, date_from: str = None, date_to: str = None):
        """
        Fetch all records (bookings) from Altegio
        Returns list of appointments/records
        """
        url = f"{self.base_url}/records/{self.company_id}"
        params = {}
        if date_from:
            params["start_date"] = date_from
        if date_to:
            params["end_date"] = date_to
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=self.get_headers(), params=params)
            if response.status_code == 200:
                data = response.json()
                return data.get("data", [])
            else:
                logging.error(f"Altegio API error: {response.status_code} - {response.text}")
                return []
    
    async def get_group_events(self):
        """
        Fetch group events (activities) from Altegio
        Returns list of group events
        """
        url = f"{self.base_url}/activity/{self.company_id}/search/"
        params = {
            "from": datetime.now().strftime("%Y-%m-%d"),
            "till": (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=self.get_v2_headers(), params=params)
            if response.status_code == 200:
                data = response.json()
                return data.get("data", [])
            else:
                logging.error(f"Altegio activities error: {response.status_code} - {response.text}")
                return []
    
    async def get_activity_bookings(self, activity_id: str):
        """
        Get bookings for a specific activity/event
        Returns booking count and details
        """
        url = f"{self.base_url}/activity/{self.company_id}/{activity_id}/records"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=self.get_v2_headers())
            if response.status_code == 200:
                data = response.json()
                return data.get("data", [])
            else:
                logging.error(f"Altegio activity bookings error: {response.status_code} - {response.text[:200]}")
                return None
    
    async def get_services(self):
        """Get all services from Altegio.

        Uses the V2 auth header (Bearer Partner, User UserToken). The V1
        /services endpoint accepts either, but the partner-format header
        is the only one that returns the full catalog for our company —
        plain Bearer UserToken silently returned an empty list.
        """
        url = f"{self.base_url}/company/{self.company_id}/services"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=self.get_v2_headers())
            if response.status_code == 200:
                data = response.json()
                return data.get("data", [])
            else:
                logging.error(f"Altegio services error: {response.status_code} — {response.text[:200]}")
                return []
    
    async def create_record(self, service_id: str, staff_id: str, client_name: str, 
                           client_phone: str, datetime_str: str, comment: str = ""):
        """Create a new booking/record in Altegio"""
        url = f"{self.base_url}/records/{self.company_id}"
        payload = {
            "staff_id": staff_id,
            "services": [{"id": service_id}],
            "client": {
                "name": client_name,
                "phone": client_phone
            },
            "datetime": datetime_str,
            "comment": comment
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=self.get_headers(), json=payload)
            if response.status_code in [200, 201]:
                return response.json().get("data", {})
            else:
                logging.error(f"Altegio create record error: {response.status_code} - {response.text}")
                raise HTTPException(status_code=response.status_code, detail="Failed to create record in Altegio")

    # ---- V2 API Methods (push sync) ----
    
    def get_v2_headers(self, user_token: Optional[str] = None):
        """Get V2 API authorization headers (requires partner + user tokens)"""
        effective_user_token = user_token or self.user_token
        return {
            "Authorization": f"Bearer {ALTEGIO_PARTNER_TOKEN}, User {effective_user_token}",
            "Accept": "application/vnd.api.v2+json",
            "Content-Type": "application/json"
        }

    def get_v2_push_headers(self):
        """Use a write-capable user token for create/update/delete when configured."""
        return self.get_v2_headers(self.push_user_token)
    
    def _calc_length_seconds(self, start_time: str, end_time: str) -> int:
        """Calculate event length in seconds from HH:MM strings"""
        try:
            sh, sm = map(int, start_time.split(':'))
            eh, em = map(int, end_time.split(':'))
            return max((eh * 60 + em - sh * 60 - sm) * 60, 3600)
        except:
            return 3600  # default 1 hour
    
    async def create_activity(self, title: str, date: str, start_time: str = "14:00",
                               end_time: str = "16:00", capacity: int = 10, comment: str = "",
                               service_id: Optional[int] = None):
        """Create a group activity/event in Altegio via V2 API.

        service_id: per-event Altegio service id. If not provided, falls back to ALTEGIO_DEFAULT_SERVICE_ID.
        """
        result = await self.create_activity_result(
            title=title,
            date=date,
            start_time=start_time,
            end_time=end_time,
            capacity=capacity,
            comment=comment,
            service_id=service_id,
        )
        return result.get("activity_id") if result.get("ok") else None

    async def create_activity_result(self, title: str, date: str, start_time: str = "14:00",
                                     end_time: str = "16:00", capacity: int = 10, comment: str = "",
                                     service_id: Optional[int] = None):
        """Create an Altegio activity and return a debuggable result object."""
        effective_service_id = service_id or ALTEGIO_DEFAULT_SERVICE_ID
        if not ALTEGIO_PARTNER_TOKEN or not self.push_user_token or not effective_service_id:
            message = "Altegio push skipped: partner token, write-capable user token, or service_id missing"
            logging.warning(message)
            return {"ok": False, "activity_id": None, "status_code": None, "body": message}

        url = f"{ALTEGIO_BASE_URL_V2}/companies/{self.company_id}/activities"
        length = self._calc_length_seconds(start_time, end_time)

        payload = {
            "staff_id": ALTEGIO_DEFAULT_STAFF_ID or 0,
            "service_id": int(effective_service_id),
            "resource_instance_ids": [],
            "label_ids": [],
            "date": f"{date} {start_time}:00",
            "length": length,
            "capacity": capacity,
            "comment": f"{title}. {comment}".strip(". "),
            "force": True
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=self.get_v2_push_headers(), json=payload)
            if response.status_code in [200, 201]:
                data = response.json()
                activity_id = data.get("data", {}).get("id")
                logging.info(f"Altegio activity created: {activity_id} for '{title}'")
                return {"ok": True, "activity_id": activity_id, "status_code": response.status_code, "body": data}

            logging.error(f"Altegio create activity error: {response.status_code} - {response.text}")
            return {"ok": False, "activity_id": None, "status_code": response.status_code, "body": response.text}
    
    async def update_activity(self, activity_id: str, title: str, date: str,
                               start_time: str = "14:00", end_time: str = "16:00",
                               capacity: int = 10, comment: str = "",
                               service_id: Optional[int] = None):
        """Update an existing activity/event in Altegio via V2 API.

        service_id: per-event Altegio service id. If not provided, falls back to ALTEGIO_DEFAULT_SERVICE_ID.
        """
        effective_service_id = service_id or ALTEGIO_DEFAULT_SERVICE_ID
        if not ALTEGIO_PARTNER_TOKEN or not self.push_user_token or not activity_id or not effective_service_id:
            return None

        url = f"{ALTEGIO_BASE_URL_V2}/companies/{self.company_id}/activities/{activity_id}"
        length = self._calc_length_seconds(start_time, end_time)

        payload = {
            "staff_id": ALTEGIO_DEFAULT_STAFF_ID or 0,
            "service_id": int(effective_service_id),
            "resource_instance_ids": [],
            "label_ids": [],
            "date": f"{date} {start_time}:00",
            "length": length,
            "capacity": capacity,
            "comment": f"{title}. {comment}".strip(". "),
            "force": True
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.put(url, headers=self.get_v2_push_headers(), json=payload)
            if response.status_code == 200:
                logging.info(f"Altegio activity updated: {activity_id}")
                return True
            else:
                logging.error(f"Altegio update activity error: {response.status_code} - {response.text}")
                return None
    
    async def delete_activity(self, activity_id: str):
        """Delete an activity/event in Altegio via V2 API"""
        if not ALTEGIO_PARTNER_TOKEN or not self.push_user_token or not activity_id:
            return None
        
        url = f"{ALTEGIO_BASE_URL_V2}/companies/{self.company_id}/activities/{activity_id}"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(url, headers=self.get_v2_push_headers())
            if response.status_code in [200, 204]:
                logging.info(f"Altegio activity deleted: {activity_id}")
                return True
            else:
                logging.error(f"Altegio delete activity error: {response.status_code} - {response.text}")
                return None

altegio_client = AltegioClient()

# Altegio API Response Models
class AltegioSyncResponse(BaseModel):
    synced_count: int
    events: List[dict]
    message: str

@api_router.get("/altegio/events")
async def get_altegio_events():
    """Fetch all events/activities from Altegio"""
    try:
        events = await altegio_client.get_group_events()
        return {"events": events, "count": len(events)}
    except Exception as e:
        logging.error(f"Failed to fetch Altegio events: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/altegio/records")
async def get_altegio_records(date_from: str = None, date_to: str = None):
    """Fetch all records/bookings from Altegio"""
    try:
        records = await altegio_client.get_records(date_from, date_to)
        return {"records": records, "count": len(records)}
    except Exception as e:
        logging.error(f"Failed to fetch Altegio records: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/altegio/services")
async def get_altegio_services():
    """Fetch all services from Altegio"""
    try:
        services = await altegio_client.get_services()
        return {"services": services, "count": len(services)}
    except Exception as e:
        logging.error(f"Failed to fetch Altegio services: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/altegio/sync/pull")
async def sync_from_altegio():
    """
    Pull events and bookings from Altegio and sync to local database.
    Updates booking counts for existing events.
    """
    try:
        # Fetch activities/events from Altegio
        altegio_events = await altegio_client.get_group_events()
        synced_count, synced_events = await _sync_altegio_events_to_local(altegio_events)
        
        return {
            "synced_count": synced_count,
            "events": synced_events,
            "message": f"Синхронізовано {synced_count} подій з Altegio"
        }
    except Exception as e:
        logging.error(f"Altegio sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/altegio/event/{event_id}/push")
async def push_single_event_to_altegio(event_id: str):
    """Push a local event to Altegio and return the exact Altegio result."""
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    existing_altegio_id = event.get("altegio_id") or event.get("altegio_activity_id")
    if existing_altegio_id:
        return {
            "event_id": event_id,
            "altegio_id": str(existing_altegio_id),
            "message": "Event already linked to Altegio",
        }

    service_id = await _resolve_altegio_service_id(
        event.get("title", ""),
        explicit_service_id=event.get("altegio_service_id") or ALTEGIO_DEFAULT_SERVICE_ID or None,
        spots=event.get("spots") or 10,
    )

    if not service_id:
        raise HTTPException(status_code=400, detail="No matching Altegio service for event title")

    result = await altegio_client.create_activity_result(
        title=event.get("title", ""),
        date=event.get("date", "")[:10],
        start_time=event.get("start_time") or "14:00",
        end_time=event.get("end_time") or "16:00",
        capacity=event.get("spots") or 10,
        comment=event.get("description") or "",
        service_id=int(service_id),
    )

    if not result.get("ok") or not result.get("activity_id"):
        raise HTTPException(status_code=502, detail=result)

    altegio_id = str(result["activity_id"])
    await db.events.update_one(
        {"id": event_id},
        {"$set": {
            "altegio_id": altegio_id,
            "altegio_activity_id": altegio_id,
            "altegio_service_id": int(service_id),
            "altegio_last_sync": datetime.now(timezone.utc).isoformat(),
            "altegio_last_error": None,
            "altegio_last_status_code": result.get("status_code"),
        }},
    )

    return {
        "event_id": event_id,
        "altegio_id": altegio_id,
        "service_id": int(service_id),
        "status_code": result.get("status_code"),
        "message": "Pushed to Altegio",
    }


@api_router.get("/altegio/event/{event_id}/bookings")
async def get_event_bookings_from_altegio(event_id: str):
    """
    Get booking count for a specific event.
    First checks if event has altegio_id, then fetches from Altegio.
    """
    try:
        # Find local event
        event = await db.events.find_one({"id": event_id})
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        
        altegio_id = event.get("altegio_id") or event.get("altegio_activity_id")
        
        if altegio_id:
            bookings = await altegio_client.get_activity_bookings(altegio_id)
            booked_count = len(bookings) if bookings is not None else None

            if booked_count is None:
                altegio_events = await altegio_client.get_group_events()
                for altegio_event in altegio_events:
                    if str(altegio_event.get("id")) == str(altegio_id):
                        booked_count = _altegio_booked_count(altegio_event)
                        break

            if booked_count is None:
                booked_count = event.get("altegio_booked_count", 0) or 0
            if bookings is None:
                bookings = []
            
            # Update local event
            await db.events.update_one(
                {"id": event_id},
                {"$set": {
                    "altegio_id": str(altegio_id),
                    "altegio_activity_id": str(altegio_id),
                    "altegio_booked_count": booked_count,
                    "altegio_last_sync": datetime.now(timezone.utc).isoformat()
                }}
            )
            
            return {
                "event_id": event_id,
                "altegio_id": altegio_id,
                "booked_count": booked_count,
                "capacity": event.get("spots", 0),
                "available": event.get("spots", 0) - booked_count,
                "bookings": bookings
            }
        else:
            return {
                "event_id": event_id,
                "altegio_id": None,
                "booked_count": 0,
                "message": "Event not linked to Altegio"
            }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to get bookings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/altegio/event/{event_id}/sync")
async def sync_single_event_from_altegio(event_id: str):
    """Sync a single event from Altegio"""
    try:
        # Find local event
        event = await db.events.find_one({"id": event_id})
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        
        altegio_id = event.get("altegio_id") or event.get("altegio_activity_id")
        
        if altegio_id:
            # Fetch all Altegio events and find the matching one
            altegio_events = await altegio_client.get_group_events()
            for altegio_event in altegio_events:
                if str(altegio_event.get("id")) == str(altegio_id):
                    records_count = _altegio_booked_count(altegio_event)
                    await db.events.update_one(
                        {"id": event_id},
                        {"$set": {
                            "altegio_id": str(altegio_id),
                            "altegio_activity_id": str(altegio_id),
                            "altegio_booked_count": records_count,
                            "spots": int(altegio_event.get("capacity") or event.get("spots") or 10),
                            "altegio_last_sync": datetime.now(timezone.utc).isoformat()
                        }}
                    )
                    return {
                        "event_id": event_id,
                        "altegio_id": altegio_id,
                        "booked_count": records_count,
                        "message": "Синхронізовано"
                    }
            
            await db.events.update_one(
                {"id": event_id},
                {"$set": {
                    "altegio_last_error": f"Altegio activity {altegio_id} not found",
                    "altegio_last_status_code": 404,
                    "altegio_last_sync": datetime.now(timezone.utc).isoformat(),
                }}
            )
            raise HTTPException(status_code=404, detail="подію не знайдено в Altegio за збереженим id")
        else:
            # Try to find by title
            altegio_events = await altegio_client.get_group_events()
            for altegio_event in altegio_events:
                same_title = _titles_match(event.get("title", ""), _altegio_event_title(altegio_event))
                same_date = not _altegio_event_date(altegio_event) or event.get("date", "").startswith(_altegio_event_date(altegio_event))
                if same_title and same_date:
                    altegio_id = str(altegio_event.get("id"))
                    linked_event = await db.events.find_one({
                        "id": {"$ne": event_id},
                        "$or": [
                            {"altegio_id": altegio_id},
                            {"altegio_activity_id": altegio_id},
                        ],
                    }, {"_id": 0, "id": 1, "title": 1, "date": 1})
                    if linked_event:
                        await db.events.update_one(
                            {"id": event_id},
                            {"$set": {
                                "altegio_last_error": f"Altegio activity {altegio_id} already linked to {linked_event.get('id')}",
                                "altegio_last_status_code": 409,
                                "altegio_last_sync": datetime.now(timezone.utc).isoformat(),
                            }}
                        )
                        raise HTTPException(
                            status_code=409,
                            detail=f"ця подія в Altegio вже привʼязана до іншої події Poriadok: {linked_event.get('title')} {linked_event.get('date')}",
                        )

                    records_count = _altegio_booked_count(altegio_event)
                    await db.events.update_one(
                        {"id": event_id},
                        {"$set": {
                            "altegio_id": altegio_id,
                            "altegio_activity_id": altegio_id,
                            "altegio_booked_count": records_count,
                            "spots": int(altegio_event.get("capacity") or event.get("spots") or 10),
                            "altegio_last_sync": datetime.now(timezone.utc).isoformat()
                        }}
                    )
                    return {
                        "event_id": event_id,
                        "altegio_id": altegio_id,
                        "booked_count": records_count,
                        "message": "Знайдено та синхронізовано"
                    }
            
            await db.events.update_one(
                {"id": event_id},
                {"$set": {
                    "altegio_last_error": "No matching Altegio activity by title/date",
                    "altegio_last_status_code": 404,
                    "altegio_last_sync": datetime.now(timezone.utc).isoformat(),
                }}
            )
            raise HTTPException(status_code=404, detail="не знайдено відповідної події в Altegio за назвою і датою")
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to sync single event: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/altegio/link-event")
async def link_event_to_altegio(event_id: str, altegio_id: str):
    """Manually link a local event to an Altegio activity"""
    try:
        result = await db.events.update_one(
            {"id": event_id},
            {"$set": {"altegio_id": altegio_id, "altegio_activity_id": altegio_id}}
        )
        
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
        
        return {"message": "Event linked successfully", "event_id": event_id, "altegio_id": altegio_id}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to link event: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
