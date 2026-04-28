from fastapi import FastAPI, APIRouter, HTTPException
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
ALTEGIO_PARTNER_TOKEN = os.environ.get("ALTEGIO_PARTNER_TOKEN", "")
ALTEGIO_DEFAULT_SERVICE_ID = int(os.environ.get("ALTEGIO_DEFAULT_SERVICE_ID", "0"))
ALTEGIO_DEFAULT_STAFF_ID = int(os.environ.get("ALTEGIO_DEFAULT_STAFF_ID", "0"))

# Background task for Altegio auto-sync
altegio_sync_task = None

async def altegio_auto_sync():
    """Background task to sync Altegio data every 60 minutes"""
    while True:
        try:
            await asyncio.sleep(60 * 60)  # Wait 60 minutes
            logging.info("Starting scheduled Altegio sync...")
            
            if not ALTEGIO_USER_TOKEN:
                logging.warning("Altegio token not configured, skipping sync")
                continue
            
            # Fetch activities/events from Altegio
            url = f"{ALTEGIO_BASE_URL}/activity/{ALTEGIO_COMPANY_ID}/search/"
            headers = {
                "Authorization": f"Bearer {ALTEGIO_USER_TOKEN}",
                "Accept": "application/vnd.api.v2+json"
            }
            params = {
                "from": datetime.now().strftime("%Y-%m-%d"),
                "till": (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")
            }
            
            async with httpx.AsyncClient(timeout=30.0) as http_client:
                response = await http_client.get(url, headers=headers, params=params)
                if response.status_code == 200:
                    altegio_events = response.json().get("data", [])
                    synced_count = 0
                    
                    for altegio_event in altegio_events:
                        altegio_id = str(altegio_event.get("id"))
                        title = altegio_event.get("service", {}).get("title", "") or altegio_event.get("title", "")
                        records_count = altegio_event.get("records_count", 0)
                        
                        # Update local events that match by title
                        result = await db.events.update_many(
                            {"title": {"$regex": title, "$options": "i"}},
                            {"$set": {
                                "altegio_id": altegio_id,
                                "altegio_booked_count": records_count,
                                "altegio_last_sync": datetime.now(timezone.utc).isoformat()
                            }}
                        )
                        if result.modified_count > 0:
                            synced_count += result.modified_count
                    
                    logging.info(f"Altegio auto-sync completed: {synced_count} events updated")
                else:
                    logging.error(f"Altegio sync failed: {response.status_code}")
        except asyncio.CancelledError:
            logging.info("Altegio sync task cancelled")
            break
        except Exception as e:
            logging.error(f"Altegio auto-sync error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    global altegio_sync_task
    # Startup: Start background sync task
    altegio_sync_task = asyncio.create_task(altegio_auto_sync())
    logging.info("Altegio auto-sync started (every 60 minutes)")
    
    # Run initial sync after 5 seconds
    async def initial_sync():
        await asyncio.sleep(5)
        if ALTEGIO_USER_TOKEN:
            logging.info("Running initial Altegio sync...")
            try:
                url = f"{ALTEGIO_BASE_URL}/activity/{ALTEGIO_COMPANY_ID}/search/"
                headers = {
                    "Authorization": f"Bearer {ALTEGIO_USER_TOKEN}",
                    "Accept": "application/vnd.api.v2+json"
                }
                params = {
                    "from": datetime.now().strftime("%Y-%m-%d"),
                    "till": (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")
                }
                async with httpx.AsyncClient(timeout=30.0) as http_client:
                    response = await http_client.get(url, headers=headers, params=params)
                    if response.status_code == 200:
                        altegio_events = response.json().get("data", [])
                        for altegio_event in altegio_events:
                            altegio_id = str(altegio_event.get("id"))
                            title = altegio_event.get("service", {}).get("title", "") or altegio_event.get("title", "")
                            records_count = altegio_event.get("records_count", 0)
                            await db.events.update_many(
                                {"title": {"$regex": title, "$options": "i"}},
                                {"$set": {
                                    "altegio_id": altegio_id,
                                    "altegio_booked_count": records_count,
                                    "altegio_last_sync": datetime.now(timezone.utc).isoformat()
                                }}
                            )
                        logging.info(f"Initial Altegio sync: {len(altegio_events)} events processed")
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
                column_to_assignee = {"management": "karolina", "smm": "kasya", "marketing": "vo"}
                count = 0
                for task_id, task_info in calculated.items():
                    assignee = column_to_assignee.get(task_info["column"], "karolina")
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
        column_to_assignee = {"management": "karolina", "smm": "kasya", "marketing": "vo"}
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
                    "assignee": column_to_assignee.get(task["column"], "karolina"),
                    "completed": False,
                    "completed_at": None,
                    "created_at": now.isoformat(),
                    "daily_source": task["id"],
                    "column": task["column"],
                }
                await db.standalone_tasks.insert_one(standalone)
                logging.info(f"Auto-generated daily task: {task_id}")
    
    asyncio.create_task(auto_generate_daily())
    
    yield
    
    # Shutdown: Cancel background task
    if altegio_sync_task:
        altegio_sync_task.cancel()
        try:
            await altegio_sync_task
        except asyncio.CancelledError:
            pass
    logging.info("Altegio auto-sync stopped")

app = FastAPI(lifespan=lifespan)
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================

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
    task_overrides: Dict[str, dict] = {}
    # Google Calendar integration
    google_calendar_event_id: Optional[str] = None

class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = "global_settings"
    reminder_types: List[ReminderType] = []

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
    assignee: str = "karolina"  # "kasya", "karolina", "vo" - determines column
    completed: bool = False
    completed_at: Optional[str] = None
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
    assignee: str = "karolina"

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

# MANAGEMENT event tasks (column: karolina)
# series_master_only: True = task created ONLY for the master (first) instance
# of a recurring series; series children skip it. Used for one-off prep work
# that doesn't repeat per session (gathering info, designing announcement, etc.)
MANAGEMENT_TASKS = [
    {"id": "mgmt_info_master", "name": "попросити інфу від майстра", "days_before": 35, "condition": None, "series_master_only": True},
    {"id": "mgmt_photo_master", "name": "узгодити зйомки майстра і передати контакт оператору", "days_before": 35, "condition": None, "series_master_only": True},
    {"id": "mgmt_info_to_smm", "name": "інфу від майстра в smm", "days_before": 30, "condition": None, "series_master_only": True},
    {"id": "mgmt_check_announce", "name": "перевірити чи все готово до анонсу", "days_before": 13, "condition": None, "series_master_only": True},
    {"id": "mgmt_master_story", "name": "попросити майстра зняти розмовний сторіс", "days_before": 10, "condition": {"type": "booking_below", "threshold": 50}},
    {"id": "mgmt_direct_discuss", "name": "дірект розсилка і обговорити з маркетологом", "days_before": 10, "condition": {"type": "booking_below", "threshold": 50}},
    {"id": "mgmt_cancel_event", "name": "відміна події", "days_before": 3, "condition": {"type": "booking_below", "threshold": 50}},
    {"id": "mgmt_push_marketer", "name": "пиздити маркетолога", "days_before": 2, "condition": {"type": "booking_below", "threshold": 60}},
    {"id": "mgmt_remind_participants", "name": "нагадування учасникам", "days_before": 1, "condition": None},
    {"id": "mgmt_prepare_studio", "name": "підготовка студії", "days_before": 0, "condition": None},
    {"id": "mgmt_clean_studio", "name": "прибирання студії", "days_before": 0, "condition": None},
    {"id": "mgmt_expenses", "name": "внесення витрат і оплат", "days_before": 0, "condition": None},
    # pay_master: for regular series children we skip this entirely; create_event
    # post-processes the series so it lands once per calendar month (on the last
    # instance of that month). See create_event regular-series branch.
    {"id": "mgmt_pay_master", "name": "оплата майстру", "days_before": 0, "condition": None, "series_master_only": True},
    {"id": "mgmt_send_feedback", "name": "розіслати запрошення в чат і форму фідбеку", "days_before": -1, "condition": None, "regular_note": "регулярна → тільки новим"},
    {"id": "mgmt_pay_master_after", "name": "оплата майстру", "days_before": -1, "condition": None, "regular_note": "регулярна → вкінці місяця"},
    # NEW: replaces smm_master_studio. Manager asks master to record a studio
    # speech only when booking is poor. Master-only for series so it doesn't
    # repeat per session.
    {"id": "mgmt_master_speech", "name": "попросити майстра зняти звернення зі студії", "days_before": 10, "condition": {"type": "booking_below", "threshold": 60}, "series_master_only": True},
]

# SMM event tasks (column: kasya)
# series_master_only: True = created only for the master of a regular series
# (announce design / shoot / post / share / threads — done once per series).
# Storytelling explicitly stays per-instance (per user direction).
SMM_TASKS = [
    {"id": "smm_collect_materials", "name": "збір матеріалів та інфи для анонсу", "days_before": 30, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_select_media", "name": "відбір фото-відео", "days_before": 30, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_photo_date", "name": "узгодити дату зйомки майстра", "days_before": 29, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_design_announce", "name": "монтаж/дизайн анонсу", "days_before": 25, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_shoot_master", "name": "зйомка майстра", "days_before": 20, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_text_announce", "name": "текст для анонсу", "days_before": 19, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_video_master", "name": "монтаж відео-майстра", "days_before": 18, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_video_feedbacks", "name": "монтаж фідбеків", "days_before": 18, "condition": None, "is_announcement": False, "series_master_only": True},
    {"id": "smm_storytelling_prep", "name": "підготовка сторітеллінгу", "days_before": 18, "condition": None, "is_announcement": False, "series_master_only": True},
    # smm_content_teamwork removed — covered by monthly task `monthly_content_plan_tw`
    {"id": "smm_post_announce", "name": "пост анонсу", "days_before": 14, "condition": None, "is_announcement": True, "series_master_only": True},
    {"id": "smm_share_tg", "name": "шер анонсу в тг", "days_before": 14, "condition": None, "is_announcement": True, "series_master_only": True},
    {"id": "smm_storytelling", "name": "сторітеллінг", "days_before": 14, "condition": None, "is_announcement": True},
    {"id": "smm_threads_warmup", "name": "прогрів теми в threads", "days_before": 14, "condition": None, "is_announcement": True, "series_master_only": True},
    {"id": "smm_ping_ambassadors", "name": "пінг амбасадорів", "days_before": 14, "condition": None, "is_announcement": False},
    {"id": "smm_start_targeting", "name": "запуск таргетингу", "days_before": 12, "condition": {"type": "booking_below", "threshold": 40}, "is_announcement": False},
    # smm_master_studio removed — replaced by mgmt_master_speech (booking_below 60).
    {"id": "smm_past_events_50", "name": "сторіс з минулих подій і фідбеки", "days_before": 10, "condition": {"type": "booking_below", "threshold": 50}, "is_announcement": False},
    {"id": "smm_update_target_50", "name": "апдейт таргетингу", "days_before": 10, "condition": {"type": "booking_below", "threshold": 50}, "is_announcement": False},
    {"id": "smm_master_story", "name": "розмовний сторіс майстра", "days_before": 8, "condition": {"type": "booking_below", "threshold": 60}, "is_announcement": False},
    {"id": "smm_update_target_60", "name": "апдейт таргетингу", "days_before": 8, "condition": {"type": "booking_below", "threshold": 60}, "is_announcement": False},
    {"id": "smm_storytelling_60", "name": "сторітеллінг", "days_before": 7, "condition": {"type": "booking_below", "threshold": 60}, "is_announcement": False},
    {"id": "smm_stop_targeting", "name": "зупинити таргетинг", "days_before": 7, "condition": {"type": "booking_above", "threshold": 90}, "is_announcement": False},
    {"id": "smm_past_events_80", "name": "сторіс з минулих подій і фідбеки", "days_before": 5, "condition": {"type": "booking_below", "threshold": 80}, "is_announcement": False},
    {"id": "smm_update_target_80", "name": "апдейт таргетингу", "days_before": 5, "condition": {"type": "booking_below", "threshold": 80}, "is_announcement": False},
    {"id": "smm_lucky_ticket", "name": "щасливий квиточок в групу", "days_before": 2, "condition": {"type": "booking_below", "threshold": 80}, "is_announcement": False},
    {"id": "smm_remind_story", "name": "нагадування в сторіс", "days_before": 1, "condition": {"type": "booking_below", "threshold": 90}, "is_announcement": False},
    # Day-of content shoot/post — only when booking is weak (extra material is
    # the way to push it). Otherwise optional / not mandatory.
    {"id": "smm_shoot_content", "name": "знімати контент", "days_before": 0, "condition": {"type": "booking_below", "threshold": 70}, "is_announcement": False},
    {"id": "smm_post_stories", "name": "постити сторі відразу з події", "days_before": 0, "condition": {"type": "booking_below", "threshold": 70}, "is_announcement": False},
    {"id": "smm_upload_google", "name": "оптимізувати фото-відео, видалити невдалі і залити на google photo", "days_before": -1, "condition": None, "is_announcement": False},
]

# MARKETING event tasks (column: vo)
MARKETING_TASKS = [
    # mktg_content_teamwork removed — covered by monthly task `monthly_mktg_content_tw`
    {"id": "mktg_personal_invites", "name": "особисті запрошення", "days_before": 5, "condition": {"type": "booking_below", "threshold": 70}},
]

# MONTHLY AUTO-TASKS (generated relative to 1st of each month)
MONTHLY_TASKS = [
    {"id": "monthly_plan_teamwork", "name": "план подій тімворк", "days_before": 50, "column": "management", "is_teamwork": True, "calendar_event": {"title_template": "план подій на {month}", "start_time": "14:00", "end_time": "15:00"}},
    {"id": "monthly_ambassadors", "name": "написати амбасадорам", "days_before": 50, "column": "marketing"},
    {"id": "monthly_influencers", "name": "вибрати 10 інфлюенсерів", "days_before": 40, "column": "marketing"},
    {"id": "monthly_content_plan_tw", "name": "контент-план тімворк", "days_before": 40, "column": "smm", "is_teamwork": True, "calendar_event": {"title_template": "контент-план на {month}", "start_time": "14:00", "end_time": "16:00"}},
    {"id": "monthly_approve_memes", "name": "затвердити ідеї мемів", "days_before": 7, "column": "marketing", "calendar_event": {"title_template": "затвердити ідеї мемів", "start_time": "17:00", "end_time": "18:00"}},
    # Management monthly
    {"id": "monthly_mgmt_check_mktg", "name": "перевірити маркетинг план", "days_before": 39, "column": "management"},
    # SMM monthly
    {"id": "monthly_smm_influencers", "name": "написати інфлюенсерам", "days_before": 40, "column": "smm"},
    {"id": "monthly_smm_info_posts", "name": "обговорення інфо-постів", "days_before": 40, "column": "smm"},
    {"id": "monthly_smm_meme_ideas", "name": "ідеї для мемів", "days_before": 10, "column": "smm"},
    {"id": "monthly_smm_discuss_memes", "name": "обговорити ідеї мемів", "days_before": 7, "column": "smm"},
    {"id": "monthly_smm_calendar_memes", "name": "внести в календар меми", "days_before": 7, "column": "smm"},
    {"id": "monthly_smm_make_meme_5", "name": "зробити мем", "days_before": 5, "column": "smm"},
    {"id": "monthly_smm_make_meme_3", "name": "зробити мем", "days_before": 3, "column": "smm"},
    # Marketing monthly
    {"id": "monthly_mktg_plan_tw", "name": "план подій тімворк", "days_before": 50, "column": "marketing", "is_teamwork": True},
    {"id": "monthly_mktg_content_tw", "name": "контент-план тімворк", "days_before": 40, "column": "marketing", "is_teamwork": True},
    {"id": "monthly_mktg_info_posts", "name": "обговорення інфо-постів", "days_before": 40, "column": "marketing"},
    {"id": "monthly_mktg_discuss_memes", "name": "обговорити ідеї мемів", "days_before": 7, "column": "marketing"},
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

# Helper: get all tasks for a column
def get_tasks_for_column(column):
    tasks = []
    if column == "management":
        tasks = MANAGEMENT_TASKS
    elif column == "smm":
        tasks = SMM_TASKS
    elif column == "marketing":
        tasks = MARKETING_TASKS
    return tasks

def calculate_event_tasks(event_date_str, column, is_series_child: bool = False):
    """Calculate task dates for a specific column based on event date.

    is_series_child: when True (event is a non-master instance of a regular
    series), tasks marked `series_master_only` are skipped — they were
    already attached to the master and shouldn't repeat per session.
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

def calculate_reminder_dates(event_date: str, reminder_types: List[ReminderType], is_series_child: bool = False) -> Dict[str, str]:
    """Calculate management task dates - now uses MANAGEMENT_TASKS"""
    return calculate_event_tasks(event_date, "management", is_series_child=is_series_child)

def calculate_marketing_dates(event_date: str, is_series_child: bool = False) -> Dict[str, str]:
    """Calculate marketing task dates"""
    return calculate_event_tasks(event_date, "marketing", is_series_child=is_series_child)

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

def calculate_smm_dates(event_date: str, is_series_child: bool = False) -> Dict[str, str]:
    """Calculate SMM task dates based on event date with date corrections"""
    return calculate_event_tasks(event_date, "smm", is_series_child=is_series_child)

# ==================== EVENTS API ====================

@api_router.get("/")
async def root():
    return {"message": "sensa API"}

@api_router.get("/quote")
async def get_quote():
    return {"quote": get_daily_quote()}

async def _persist_event(event_data: EventCreate, settings, source_event_id: str = "", sync_external: bool = True) -> Event:
    """Insert one event into DB; optionally push to Google Calendar + Altegio.

    Used by both single-event creation and regular-series expansion.
    Children of a series (source_event_id present) skip series_master_only
    tasks — those are attached only to the master.
    """
    is_series_child = bool(source_event_id)
    reminders = calculate_reminder_dates(event_data.date, settings.reminder_types, is_series_child=is_series_child)
    smm_tasks = calculate_smm_dates(event_data.date, is_series_child=is_series_child)
    marketing_tasks = calculate_marketing_dates(event_data.date, is_series_child=is_series_child)

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
            await db.events.update_one({"id": event.id}, {"$set": {"google_calendar_id": result.get("id")}})
            logging.info(f"Auto-exported event {event.title} to Google Calendar")
    except Exception as e:
        logging.error(f"Failed to auto-export to Google Calendar: {e}")

    # Altegio (per-event service_id wins, default as fallback)
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
                service_id=event.altegio_service_id,
            )
            if altegio_id:
                await db.events.update_one({"id": event.id}, {"$set": {"altegio_activity_id": str(altegio_id)}})
                logging.info(f"Auto-pushed event '{event.title}' to Altegio: {altegio_id}")
    except Exception as e:
        logging.error(f"Failed to push event to Altegio: {e}")


@api_router.post("/events")
async def create_event(event_data: EventCreate):
    settings = await get_settings()

    is_regular = event_data.event_type == "regular" and bool(event_data.repeat_days)

    if not is_regular:
        # Single one-off event — full external sync
        event = await _persist_event(event_data, settings, sync_external=True)
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

    # First instance is the master (full sync); children link to it via source_event_id
    master_payload = event_data.model_copy(update={"date": dates[0].isoformat()})
    master = await _persist_event(master_payload, settings, sync_external=True)

    for d in dates[1:]:
        child_payload = event_data.model_copy(update={"date": d.isoformat()})
        # External sync of children skipped for speed; Phase 8B (cron sync) will fill them in
        await _persist_event(child_payload, settings, source_event_id=master.id, sync_external=False)

    # Post-process: pay_master fires once per calendar month — on the LAST
    # instance of that month. Master/children otherwise skip mgmt_pay_master
    # (series_master_only=True). This pass adds it back to the right instance.
    await _attach_monthly_pay_master(master.id, dates)

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
            await db.events.update_one({"id": event.id}, {"$set": {"google_calendar_id": result.get("id")}})
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
                await db.events.update_one({"id": event_id}, {"$set": {"altegio_activity_id": None}})
            else:
                await altegio_client.update_activity(
                    activity_id=altegio_id,
                    title=updated.get("title", existing.get("title", "")),
                    date=updated.get("date", existing.get("date", ""))[:10],
                    start_time=updated.get("start_time") or existing.get("start_time") or "14:00",
                    end_time=updated.get("end_time") or existing.get("end_time") or "16:00",
                    capacity=updated.get("spots") or existing.get("spots") or 10,
                    comment=updated.get("description") or existing.get("description") or "",
                    service_id=updated.get("altegio_service_id") or existing.get("altegio_service_id")
                )
    except Exception as e:
        logging.error(f"Failed to sync event update to Altegio: {e}")
    
    return updated

@api_router.patch("/events/{event_id}", response_model=Event)
async def patch_event(event_id: str, event_data: dict):
    """Patch event - used for cancel/restore functionality"""
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")
    
    update_dict = {}
    
    # Handle cancellation
    if event_data.get("cancelled") == True:
        update_dict["cancelled"] = True
        # Clear all reminders and tasks when cancelling
        update_dict["reminders"] = {}
        update_dict["smm_tasks"] = {}
        
        # Delete from Google Calendar if exists
        google_calendar_event_id = existing.get("google_calendar_event_id")
        if google_calendar_event_id:
            try:
                service = await get_google_calendar_service()
                if service:
                    service.events().delete(calendarId='primary', eventId=google_calendar_event_id).execute()
                    logging.info(f"Deleted event {event_id} from Google Calendar")
                    update_dict["google_calendar_event_id"] = None
            except Exception as e:
                logging.error(f"Failed to delete from Google Calendar: {e}")
    
    # Handle restoration
    elif event_data.get("cancelled") == False:
        update_dict["cancelled"] = False
        # Restore reminders and SMM tasks based on event date
        settings = await get_settings()
        update_dict["reminders"] = calculate_reminder_dates(existing["date"], settings.reminder_types)
        update_dict["smm_tasks"] = calculate_smm_dates(existing["date"])
    
    if update_dict:
        await db.events.update_one({"id": event_id}, {"$set": update_dict})
    
    updated = await db.events.find_one({"id": event_id}, {"_id": 0})
    
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
                    service_id=updated.get("altegio_service_id") or existing.get("altegio_service_id")
                )
                if new_id:
                    await db.events.update_one({"id": event_id}, {"$set": {"altegio_activity_id": str(new_id)}})
    except Exception as e:
        logging.error(f"Failed to sync cancel/restore to Altegio: {e}")
    
    return updated

@api_router.post("/events/{event_id}/cancel-series")
async def cancel_event_series(event_id: str):
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

    cancelled_ids: List[str] = []
    for t in targets:
        tid = t["id"]
        await db.events.update_one(
            {"id": tid},
            {"$set": {"cancelled": True, "reminders": {}, "smm_tasks": {}}},
        )
        cancelled_ids.append(tid)

        # Best-effort external cleanup per instance
        gcal_id = t.get("google_calendar_event_id")
        if gcal_id:
            try:
                service = await get_google_calendar_service()
                if service:
                    service.events().delete(calendarId='primary', eventId=gcal_id).execute()
                    await db.events.update_one({"id": tid}, {"$set": {"google_calendar_event_id": None}})
            except Exception as e:
                logging.error(f"Failed to delete series instance {tid} from Google Calendar: {e}")

        altegio_id = t.get("altegio_activity_id")
        if altegio_id and ALTEGIO_PARTNER_TOKEN:
            try:
                await altegio_client.delete_activity(altegio_id)
                await db.events.update_one({"id": tid}, {"$set": {"altegio_activity_id": None}})
            except Exception as e:
                logging.error(f"Failed to delete series instance {tid} from Altegio: {e}")

    return {"cancelled_count": len(cancelled_ids), "cancelled_ids": cancelled_ids, "master_id": master_id}


@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str):
    existing = await db.events.find_one({"id": event_id}, {"_id": 0})
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
    
    return {"message": "Event deleted"}

# ==================== STANDALONE TASKS API ====================

@api_router.post("/tasks/standalone", response_model=StandaloneTask)
async def create_standalone_task(task_data: StandaloneTaskCreate):
    task = StandaloneTask(**task_data.model_dump())
    await db.standalone_tasks.insert_one(task.model_dump())
    return task

@api_router.get("/tasks/standalone", response_model=List[StandaloneTask])
async def get_standalone_tasks():
    tasks = await db.standalone_tasks.find({}, {"_id": 0}).to_list(1000)
    return tasks

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
async def update_standalone_task_full(task_id: str, task_data: StandaloneTaskCreate):
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
        "assignee": task_data.assignee
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
async def update_event_task(event_id: str, task_id: str, data: dict):
    """Update color/icon/assignee overrides and date for an event-based task"""
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    overrides = event.get("task_overrides", {})
    overrides[task_id] = {k: v for k, v in data.items() if k in ("color", "icon", "title", "assignee")}
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
    """Return the SMM tasks definition for frontend use"""
    # Return all task definitions organized by column
    return {
        "management": MANAGEMENT_TASKS,
        "smm": SMM_TASKS,
        "marketing": MARKETING_TASKS,
        "monthly": MONTHLY_TASKS,
        "daily": DAILY_TASKS,
    }


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
    column_to_assignee = {"management": "karolina", "smm": "kasya", "marketing": "vo"}
    
    for task_id, task_info in calculated.items():
        assignee = column_to_assignee.get(task_info["column"], "karolina")
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
            {"$set": {"google_calendar_event_id": result.get("id")}}
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
            if event.get("google_calendar_id"):
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
                {"$set": {"google_calendar_id": result.get("id")}}
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
    v2_configured = bool(ALTEGIO_PARTNER_TOKEN and ALTEGIO_DEFAULT_SERVICE_ID)
    return {
        "connected": bool(ALTEGIO_USER_TOKEN),
        "push_enabled": v2_configured,
        "service_id": ALTEGIO_DEFAULT_SERVICE_ID if v2_configured else None,
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
    
    url = f"https://n{company_id}.alteg.io/company/{company_id}/menu"
    return {
        "url": url, 
        "message": "Відкриваю сторінку бронювання.",
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
            response = await client.get(url, headers=self.get_headers(), params=params)
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
            response = await client.get(url, headers=self.get_headers())
            if response.status_code == 200:
                data = response.json()
                return data.get("data", [])
            else:
                logging.error(f"Altegio activity bookings error: {response.status_code}")
                return []
    
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
    
    def get_v2_headers(self):
        """Get V2 API authorization headers (requires partner + user tokens)"""
        return {
            "Authorization": f"Bearer {ALTEGIO_PARTNER_TOKEN}, User {self.user_token}",
            "Accept": "application/vnd.api.v2+json",
            "Content-Type": "application/json"
        }
    
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
        effective_service_id = service_id or ALTEGIO_DEFAULT_SERVICE_ID
        if not ALTEGIO_PARTNER_TOKEN or not effective_service_id:
            logging.warning("Altegio push skipped: ALTEGIO_PARTNER_TOKEN missing, or no service_id (per-event nor default)")
            return None

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
            response = await client.post(url, headers=self.get_v2_headers(), json=payload)
            if response.status_code in [200, 201]:
                data = response.json()
                activity_id = data.get("data", {}).get("id")
                logging.info(f"Altegio activity created: {activity_id} for '{title}'")
                return activity_id
            else:
                logging.error(f"Altegio create activity error: {response.status_code} - {response.text}")
                return None
    
    async def update_activity(self, activity_id: str, title: str, date: str,
                               start_time: str = "14:00", end_time: str = "16:00",
                               capacity: int = 10, comment: str = "",
                               service_id: Optional[int] = None):
        """Update an existing activity/event in Altegio via V2 API.

        service_id: per-event Altegio service id. If not provided, falls back to ALTEGIO_DEFAULT_SERVICE_ID.
        """
        effective_service_id = service_id or ALTEGIO_DEFAULT_SERVICE_ID
        if not ALTEGIO_PARTNER_TOKEN or not activity_id or not effective_service_id:
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
            response = await client.put(url, headers=self.get_v2_headers(), json=payload)
            if response.status_code == 200:
                logging.info(f"Altegio activity updated: {activity_id}")
                return True
            else:
                logging.error(f"Altegio update activity error: {response.status_code} - {response.text}")
                return None
    
    async def delete_activity(self, activity_id: str):
        """Delete an activity/event in Altegio via V2 API"""
        if not ALTEGIO_PARTNER_TOKEN or not activity_id:
            return None
        
        url = f"{ALTEGIO_BASE_URL_V2}/companies/{self.company_id}/activities/{activity_id}"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(url, headers=self.get_v2_headers())
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
        
        synced_count = 0
        synced_events = []
        
        for altegio_event in altegio_events:
            altegio_id = str(altegio_event.get("id"))
            # Get title from service or event itself
            title = altegio_event.get("service", {}).get("title", "") or altegio_event.get("title", "")
            # Use records_count directly from the response (already provided by API)
            booked_count = altegio_event.get("records_count", 0)
            
            # Find matching local event by altegio_id first, then by title
            local_event = await db.events.find_one({
                "$or": [
                    {"altegio_id": altegio_id},
                    {"title": {"$regex": title, "$options": "i"}}
                ]
            })
            
            if local_event:
                # Update local event with Altegio data
                await db.events.update_one(
                    {"id": local_event["id"]},
                    {"$set": {
                        "altegio_id": altegio_id,
                        "altegio_booked_count": booked_count,
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
        
        return {
            "synced_count": synced_count,
            "events": synced_events,
            "message": f"Синхронізовано {synced_count} подій з Altegio"
        }
    except Exception as e:
        logging.error(f"Altegio sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
        
        altegio_id = event.get("altegio_id")
        
        if altegio_id:
            # Fetch from Altegio
            bookings = await altegio_client.get_activity_bookings(altegio_id)
            booked_count = len(bookings)
            
            # Update local event
            await db.events.update_one(
                {"id": event_id},
                {"$set": {
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
        
        altegio_id = event.get("altegio_id")
        
        if altegio_id:
            # Fetch all Altegio events and find the matching one
            altegio_events = await altegio_client.get_group_events()
            for altegio_event in altegio_events:
                if str(altegio_event.get("id")) == str(altegio_id):
                    records_count = altegio_event.get("records_count", 0)
                    await db.events.update_one(
                        {"id": event_id},
                        {"$set": {
                            "altegio_booked_count": records_count,
                            "altegio_last_sync": datetime.now(timezone.utc).isoformat()
                        }}
                    )
                    return {
                        "event_id": event_id,
                        "altegio_id": altegio_id,
                        "booked_count": records_count,
                        "message": "Синхронізовано"
                    }
            
            return {"event_id": event_id, "message": "Event not found in Altegio"}
        else:
            # Try to find by title
            title = event.get("title", "")
            altegio_events = await altegio_client.get_group_events()
            for altegio_event in altegio_events:
                altegio_title = altegio_event.get("service", {}).get("title", "") or altegio_event.get("title", "")
                if title.lower() in altegio_title.lower() or altegio_title.lower() in title.lower():
                    altegio_id = str(altegio_event.get("id"))
                    records_count = altegio_event.get("records_count", 0)
                    await db.events.update_one(
                        {"id": event_id},
                        {"$set": {
                            "altegio_id": altegio_id,
                            "altegio_booked_count": records_count,
                            "altegio_last_sync": datetime.now(timezone.utc).isoformat()
                        }}
                    )
                    return {
                        "event_id": event_id,
                        "altegio_id": altegio_id,
                        "booked_count": records_count,
                        "message": "Знайдено та синхронізовано"
                    }
            
            return {"event_id": event_id, "message": "Не знайдено в Altegio"}
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
            {"$set": {"altegio_id": altegio_id}}
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
