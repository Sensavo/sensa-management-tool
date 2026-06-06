import { useState, useEffect, createContext, useContext, useCallback, useMemo, useRef } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { Toaster, toast } from "sonner";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit,
  ExternalLink,
  Check,
  Archive,
  X,
  Circle,
  Target,
  Zap,
  Star,
  Clock,
  Bell,
  Send,
  Sparkles,
  Award,
  Settings,
  BarChart3,
  Megaphone,
  Calendar as CalendarIcon,
  MessageCircle,
  Users,
  Camera,
  Share2,
  FileText,
  CheckCircle,
  Palette,
  Video,
  Instagram,
  Gift,
  PlusCircle,
  Coffee,
  Music,
  Heart,
  Bookmark,
  Flag,
  Lightbulb,
  Phone,
  Mail,
  MapPin,
  ArrowLeft,
  Briefcase,
  Headphones,
  RotateCcw,
  RefreshCw,
  Smile,
  Info,
  Maximize2,
  Minimize2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { uk } from "date-fns/locale";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const ACTOR_USER_STORAGE_KEY = "poriadok_actor_user";
const ACCESS_CODE_STORAGE_KEY = "poriadok_access_granted";
const ACCESS_CODE = "111";
const TEAM_USER_OPTIONS = [
  { id: "manager", label: "Manager" },
  { id: "smm", label: "SMM" },
  { id: "marketer", label: "Marketer" },
];
const ASSIGNEE_OPTIONS = TEAM_USER_OPTIONS;
const ASSIGNEE_LABELS = Object.fromEntries(ASSIGNEE_OPTIONS.map(({ id, label }) => [id, label]));
const normalizeAssignee = (value, fallback = "manager") => {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = {
    manager: "manager",
    management: "manager",
    smm: "smm",
    marketer: "marketer",
    marketing: "marketer",
    karolina: "manager",
    kasya: "smm",
    vo: "marketer",
  };
  return aliases[raw] || fallback;
};
const getAssigneeLabel = (value) => ASSIGNEE_LABELS[normalizeAssignee(value)] || ASSIGNEE_LABELS.manager;

const getActorUser = () => {
  try {
    const actor = localStorage.getItem(ACTOR_USER_STORAGE_KEY) || "";
    return actor ? normalizeAssignee(actor, "") : "";
  } catch {
    return "";
  }
};

axios.interceptors.request.use((config) => {
  const actor = getActorUser();
  if (actor) {
    config.headers = config.headers || {};
    config.headers["X-Actor-User"] = actor;
  }
  return config;
});

const AppContext = createContext();
export const useApp = () => useContext(AppContext);
const UndoContext = createContext({ pushUndo: () => {}, performUndo: () => false });
export const useUndo = () => useContext(UndoContext);

const TASK_HOTKEYS = [
  { label: "сьогодні", key: "` / 0" },
  { label: "+ день", key: "1-9" },
  { label: "видалити", key: "d / в" },
  { label: "закрити", key: "ESC" },
  { label: "зберегти", key: "⌘↵" },
];

const TaskHotkeysPanel = () => (
  <div
    className="hidden lg:block fixed z-[160] w-36 rounded-2xl border border-black/5 bg-[#F1EEE7]/95 px-3 py-3 shadow-sm backdrop-blur"
    style={{ left: "calc(50vw - 390px)", top: "50%", transform: "translateY(-50%)" }}
    data-testid="task-hotkeys-panel"
  >
    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1A1717]/45 mb-2">хоткеї</p>
    <div className="space-y-1.5 text-[11px] text-[#1A1717]/55">
      {TASK_HOTKEYS.map((hotkey) => (
        <div key={hotkey.key} className="flex items-center justify-between gap-2">
          <span>{hotkey.label}</span>
          <kbd className="hotkey-kbd">{hotkey.key}</kbd>
        </div>
      ))}
    </div>
  </div>
);

const TaskHotkeysInline = () => (
  <div className="md:hidden task-hotkeys-inline" data-testid="task-hotkeys-inline">
    <span>хоткеї</span>
    {TASK_HOTKEYS.map((hotkey) => (
      <kbd key={hotkey.key} className="hotkey-kbd">{hotkey.key}</kbd>
    ))}
  </div>
);


const api = {
  getEvents: () => axios.get(`${API}/events`),
  createEvent: (data) => axios.post(`${API}/events`, data),
  updateEvent: (id, data) => axios.put(`${API}/events/${id}`, data),
  deleteEvent: (id, confirmed = false) => axios.delete(`${API}/events/${id}`, { params: confirmed ? { manager_confirmed_cancellation: "true" } : {} }),
  cancelEventSeries: (id, confirmed = false) => axios.post(`${API}/events/${id}/cancel-series`, null, { params: confirmed ? { manager_confirmed_cancellation: "true" } : {} }),
  updateEventTask: (eventId, taskId, data) => axios.patch(`${API}/events/${eventId}/tasks/${taskId}`, data),
  deleteEventTask: async (eventId, taskId) => {
    try {
      return await axios.delete(`${API}/events/${eventId}/tasks/${taskId}`);
    } catch (error) {
      if (error?.response?.status === 405) {
        return axios.post(`${API}/events/${eventId}/tasks/${taskId}/delete`);
      }
      throw error;
    }
  },
  editTaskDef:   (taskId, data) => axios.patch(`${API}/task-definitions/${taskId}`, data),
  deleteTaskDef: (taskId) => axios.delete(`${API}/task-definitions/${taskId}`),
  createTaskDef: (data) => axios.post(`${API}/task-definitions`, data),
  revertTaskDef: (taskId) => axios.post(`${API}/task-definitions/${taskId}/revert`),
  listTaskDefOverrides: () => axios.get(`${API}/task-definitions/overrides`),
  createDayOff: (data) => axios.post(`${API}/days-off`, data),
  applyDayOffShifts: (id, plan) => axios.post(`${API}/days-off/${id}/apply`, plan),
  listDaysOff: () => axios.get(`${API}/days-off`),
  deleteDayOff: (id) => axios.delete(`${API}/days-off/${id}`),
  getSettings: () => axios.get(`${API}/settings`),
  updateSettings: (data) => axios.put(`${API}/settings`, data),
  addReminder: (data) => axios.post(`${API}/settings/reminders`, data),
  updateReminder: (id, data) => axios.put(`${API}/settings/reminders/${id}`, data),
  deleteReminder: (id) => axios.delete(`${API}/settings/reminders/${id}`),
  completeTask: (data) => axios.post(`${API}/tasks/complete`, data),
  completeSMMTask: (data) => axios.post(`${API}/tasks/smm/complete`, data),
  completeMarketingTask: (data) => axios.post(`${API}/tasks/marketing/complete`, data),
  getSMMTasksDefinition: () => axios.get(`${API}/smm/tasks-definition`),
  getTaskArchive: () => axios.get(`${API}/tasks/archive`),
  getStatistics: () => axios.get(`${API}/statistics`),
  createStandaloneTask: (data) => axios.post(`${API}/tasks/standalone`, data),
  getStandaloneTasks: () => axios.get(`${API}/tasks/standalone`),
  updateStandaloneTask: (id, completed) => axios.put(`${API}/tasks/standalone/${id}?completed=${completed}`),
  updateStandaloneTaskFull: (id, data) => axios.patch(`${API}/tasks/standalone/${id}`, data),
  deleteStandaloneTask: (id) => axios.delete(`${API}/tasks/standalone/${id}`),
  parseEvents: (text) => axios.post(`${API}/events/parse`, { text }),
  // Altegio API
  getAltegioStatus: () => axios.get(`${API}/altegio/status`),
  getAltegioEvents: () => axios.get(`${API}/altegio/events`),
  syncFromAltegio: () => axios.post(`${API}/altegio/sync/pull`),
  getEventBookings: (eventId) => axios.get(`${API}/altegio/event/${eventId}/bookings`),
  getEventAltegioUrl: (eventId) => axios.get(`${API}/events/${eventId}/altegio-url`),
  syncEventFromAltegio: (eventId) => axios.post(`${API}/altegio/event/${eventId}/sync`),
  exportEventToCalendar: (eventId) => axios.post(`${API}/calendar/events/${eventId}/export`),
  getTelegramStatus: (userId) => axios.get(`${API}/users/${userId}/telegram/status`),
  createTelegramLinkCode: (userId) => axios.post(`${API}/users/${userId}/telegram/link-code`),
  muteTelegram: (userId) => axios.post(`${API}/users/${userId}/telegram/mute`),
  unmuteTelegram: (userId) => axios.post(`${API}/users/${userId}/telegram/unmute`),
  unlinkTelegram: (userId) => axios.post(`${API}/users/${userId}/telegram/unlink`),
};

const getCancellationGuardDetail = (error) => {
  const detail = error?.response?.data?.detail;
  return detail?.code === "manager_confirmation_required" ? detail : null;
};

const confirmCancellationGuard = (error) => {
  const detail = getCancellationGuardDetail(error);
  if (!detail) return false;
  return window.confirm(`${detail.message}\n\nПідтвердити, що менеджер вже узгодив з учасниками?`);
};

const showCancellationGuardOrError = (error, fallback = "помилка") => {
  const detail = getCancellationGuardDetail(error);
  toast.error(detail?.message || fallback);
};


const getBookedCount = (event) => Number(event?.altegio_booked_count ?? event?.booked_count ?? 0) || 0;

const cancelEventAndArchive = async (event, { refreshEvents, onDone, confirmed = false } = {}) => {
  if (!event?.id) return false;
  try {
    await axios.patch(`${API}/events/${event.id}`, confirmed ? { cancelled: true, manager_confirmed_cancellation: true } : { cancelled: true });
    toast.success("подію скасовано і залишено в архіві");
    refreshEvents?.();
    onDone?.();
    return true;
  } catch (error) {
    if (confirmCancellationGuard(error)) {
      return cancelEventAndArchive(event, { refreshEvents, onDone, confirmed: true });
    }
    showCancellationGuardOrError(error);
    return false;
  }
};

const deleteEventPermanentlyFlow = async (event, { refreshEvents, onDeleted, onCancelled } = {}) => {
  if (!event?.id) return false;
  let latest = event;
  try {
    await api.syncEventFromAltegio(event.id);
    const refreshed = await axios.get(`${API}/events/${event.id}`);
    latest = refreshed.data || event;
  } catch {
    latest = event;
  }

  const booked = getBookedCount(latest);
  if (booked > 0) {
    const shouldCancel = window.confirm(`У події є ${booked} куплених/заброньованих місць. Видаляти назавжди не можна. Скасувати подію, закрити Google Calendar/Altegio і залишити в архіві?`);
    if (!shouldCancel) return false;
    return cancelEventAndArchive(latest, { refreshEvents, onDone: onCancelled });
  }

  const shouldDelete = window.confirm("Видалити подію назавжди? OK — видалити з історії. Cancel — лише скасувати і залишити в архіві.");
  if (!shouldDelete) {
    return cancelEventAndArchive(latest, { refreshEvents, onDone: onCancelled });
  }

  try {
    await api.deleteEvent(latest.id);
    toast.success("подію видалено назавжди");
    refreshEvents?.();
    onDeleted?.();
    return true;
  } catch (error) {
    const detail = getCancellationGuardDetail(error);
    if (detail) {
      const shouldCancel = window.confirm(`${detail.message}\n\nВидалення зупинено. Скасувати подію і залишити її в архіві?`);
      if (shouldCancel) return cancelEventAndArchive(latest, { refreshEvents, onDone: onCancelled });
      return false;
    }
    showCancellationGuardOrError(error, "не вдалося видалити");
    return false;
  }
};

// Helper function to get booking status color
const getBookingStatusColor = (event) => {
  if (!event.altegio_booked_count && event.altegio_booked_count !== 0) return 'default';

  const eventDate = new Date(event.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));

  const bookedPercent = (event.altegio_booked_count / (event.spots || 10)) * 100;

  // < 4 days logic (higher priority)
  if (daysUntil < 4 && daysUntil >= 0) {
    if (bookedPercent >= 70) return 'green';
    if (bookedPercent >= 50) return 'orange';
    return 'red';
  }

  // < 7 days logic
  if (daysUntil < 7 && daysUntil >= 0) {
    if (bookedPercent >= 50) return 'green';
    if (bookedPercent >= 20) return 'orange';
    return 'red';
  }

  return 'default';
};

const getBookingColorClass = (color) => {
  switch (color) {
    case 'green': return 'text-emerald-600';
    case 'orange': return 'text-orange-500';
    case 'red': return 'text-red-500';
    default: return 'text-secondary';
  }
};


const startOfLocalMonth = (date) => {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const isArchiveMonth = (monthDate, todayDate = new Date()) => startOfLocalMonth(monthDate) < startOfLocalMonth(todayDate);
const getEventDateKey = (event) => String(event?.date || '').split('T')[0];

const getEventArchiveStatus = (event, todayDate = new Date()) => {
  if (!event) return 'active';
  if (event.cancelled) return 'cancelled';
  const eventDate = new Date(event.date);
  eventDate.setHours(0, 0, 0, 0);
  const today = new Date(todayDate);
  today.setHours(0, 0, 0, 0);
  return eventDate < today ? 'completed' : 'active';
};

const getVisibleEventsForMonth = (events, currentMonth, todayDate = new Date()) => {
  const archiveMode = isArchiveMonth(currentMonth, todayDate);
  const monthPrefix = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
  const today = new Date(todayDate);
  today.setHours(0, 0, 0, 0);
  return [...events]
    .filter((event) => {
      const dateKey = getEventDateKey(event);
      if (archiveMode) return dateKey.startsWith(monthPrefix);
      return !event.cancelled && !event.archived && new Date(event.date) >= today;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
};

const getDayEventStatus = (events, date, currentMonth, todayDate = new Date()) => {
  const dateKey = formatDateLocal(date);
  const archiveMode = isArchiveMonth(currentMonth, todayDate);
  const dayEvents = events.filter(event => getEventDateKey(event) === dateKey && (archiveMode || (!event.cancelled && !event.archived)));
  if (!dayEvents.length) return '';
  if (!archiveMode) return 'active';
  if (dayEvents.some(event => event.cancelled)) return 'cancelled';
  return 'completed';
};

const getEventArchiveClass = (event, todayDate = new Date()) => {
  const status = getEventArchiveStatus(event, todayDate);
  if (status === 'cancelled') return ' event-archive-cancelled';
  if (status === 'completed') return ' event-archive-completed';
  return '';
};

const EventArchiveIcon = ({ event, today }) => {
  const status = getEventArchiveStatus(event, today);
  if (status === 'cancelled') return <span className="event-archive-icon cancelled" title="скасовано"><X className="w-3.5 h-3.5" /></span>;
  if (status === 'completed') return <span className="event-archive-icon completed" title="відбулося"><Check className="w-3.5 h-3.5" /></span>;
  return null;
};

const renderEventCalendarDay = (date, events, currentMonth, today) => {
  const status = getDayEventStatus(events, date, currentMonth, today);
  return (
    <div className="calendar-day-content">
      <span>{date.getDate()}</span>
      {status === 'active' && <span className="event-dot" />}
      {status === 'cancelled' && <X className="archive-day-icon cancelled" />}
      {status === 'completed' && <Check className="archive-day-icon completed" />}
    </div>
  );
};

const isEditableTarget = (target) => {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
};


const getStandaloneTaskPayload = (task) => ({
  title: task.title,
  date: task.date,
  icon: task.icon || 'coffee',
  type: task.type || 'regular',
  color: task.color || 'manager',
  assignee: task.assignee || 'manager',
  event_id: task.event_id || '',
  order: task.order || 0,
});


// Extended icon mapping
const ICONS = {
  bell: Bell, target: Target, zap: Zap, star: Star, clock: Clock, send: Send,
  sparkles: Sparkles, circle: Circle, megaphone: Megaphone, calendar: CalendarIcon,
  message: MessageCircle, users: Users, camera: Camera, share: Share2,
  file: FileText, check: CheckCircle, palette: Palette, video: Video,
  instagram: Instagram, gift: Gift, coffee: Coffee, music: Music, heart: Heart,
  bookmark: Bookmark, flag: Flag, lightbulb: Lightbulb, phone: Phone, mail: Mail,
  mappin: MapPin, briefcase: Briefcase, headphones: Headphones,
};

// Unique icons for custom tasks (not used in standard reminders)
// Unified 14 task icons for all dialogs
const TASK_ICONS = [
  { value: "instagram", Icon: Instagram },
  { value: "send", Icon: Send },
  { value: "video", Icon: Video },
  { value: "camera", Icon: Camera },
  { value: "share", Icon: Share2 },
  { value: "users", Icon: Users },
  { value: "message", Icon: MessageCircle },
  { value: "coffee", Icon: Coffee },
  { value: "heart", Icon: Heart },
  { value: "star", Icon: Star },
  { value: "mappin", Icon: MapPin },
  { value: "briefcase", Icon: Briefcase },
  { value: "bell", Icon: Bell },
  { value: "target", Icon: Target },
];

// Keep aliases for backward compat
const CUSTOM_TASK_ICONS = TASK_ICONS;
const SMM_TASK_ICONS = TASK_ICONS;

// SMM task icons mapping
const SMM_ICONS = {
  smm_text_announcement: "file", smm_text_video: "file", smm_approve_texts: "file",
  smm_design_announcement: "video", smm_approve_announcement: "check",
  smm_post_insta: "instagram", smm_post_tg: "send", smm_ambassadors: "users",
  smm_influencers: "star", smm_story_reminder: "message", smm_storytelling: "message",
  smm_video_master: "video", smm_past_events: "share", smm_targeting: "target",
  smm_direct: "send", smm_tg_reminder: "bell",
  mgmt_lucky_ticket: "gift",
  smm_shoot_content: "camera", smm_shoot_content_child: "camera",
  smm_post_stories: "instagram", smm_post_stories_child: "instagram",
  smm_upload_google: "share",
  smm_extra_storytelling: "message", smm_extra_reel: "video",
  mktg_check_announce: "circle", mktg_start_targeting: "target",
  mktg_update_target_50: "target", mktg_update_target_60: "target", mktg_update_target_80: "target",
  mktg_stop_targeting: "target",
  smm_video_master_subtitles: "video", smm_video_feedbacks: "video",
};

// Get task color - from SMM definition or standalone task
const getTaskColor = (taskId, smmTasksDefinition, standaloneTask) => {
  if (standaloneTask?.color) return standaloneTask.color;
  const smmTask = smmTasksDefinition?.find(t => t.id === taskId);
  return smmTask?.color || "manager";
};

// Color class mapping (no special-case for SMM/SMM — neutral across all assignees)
const getColorClass = (color) => {
  const normalizedColor = normalizeAssignee(color, color);
  if (normalizedColor === "marketer" || color === "orange") return "orange";
  if (color === "red") return "red";
  if (color === "purple") return "purple";
  if (color === "blue") return "blue";
  if (color === "pink") return "pink";
  if (color === "teal") return "teal";
  return "manager";
};

// Text-related SMM tasks (use file icon)
const TEXT_WORK_SMM_TASKS = new Set([
  "smm_text_announcement",
  "smm_text_video",
  "smm_approve_texts",
]);

const getIconComponent = (iconName) => ICONS[iconName] || Circle;

// Navigation Icons
const TasksIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="6" cy="6" r="4" /><line x1="12" y1="6" x2="22" y2="6" />
    <circle cx="6" cy="18" r="4" /><line x1="12" y1="18" x2="22" y2="18" />
  </svg>
);

const EventsIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" /><circle cx="8" cy="16" r="2" />
  </svg>
);

const SettingsIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" />
  </svg>
);

const StatsIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="4" y1="20" x2="4" y2="10" /><line x1="10" y1="20" x2="10" y2="6" />
    <line x1="16" y1="20" x2="16" y2="12" />
  </svg>
);

const SMMIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

// Ukrainian formatting
const UK_MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const UK_MONTHS_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const UK_MONTHS_NOMINATIVE = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];

// Render task condition as a short chip text. Returns null when no condition.
const formatTaskCondition = (cond) => {
  if (!cond || !cond.type) return null;
  if (cond.type === 'booking_below') return `<${cond.threshold}%`;
  if (cond.type === 'booking_above') return `>${cond.threshold}%`;
  return null;
};
const UK_WEEKDAYS = ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"];
// Accusative weekday phrases with eufonic preposition (в / у picked to avoid
// awkward consonant stacking like "в вівторок"). Reads as a date prefix:
// "Poriadok у вівторок 19 травня".
const UK_WEEKDAY_PHRASE = [
  "в неділю",
  "в понеділок",
  "у вівторок",
  "в середу",
  "у четвер",
  "в п'ятницю",
  "в суботу",
];

const formatDateUkrainian = (dateStr) => {
  const date = new Date(dateStr);
  return `${date.getDate()} ${UK_MONTHS[date.getMonth()]}`;
};

const formatDateWithWeekday = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return {
    day: d.getDate(),
    month: UK_MONTHS[d.getMonth()],
    weekday: UK_WEEKDAYS[d.getDay()],
    phrase: UK_WEEKDAY_PHRASE[d.getDay()],
  };
};

// Helper function to format date as YYYY-MM-DD using LOCAL timezone (avoids UTC shift issues)
const formatDateLocal = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shiftDateLocal = (dateStr, offset) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + offset);
  return formatDateLocal(d);
};

const formatMonthShort = (monthStr) => {
  const [year, month] = monthStr.split("-");
  return `${UK_MONTHS_SHORT[parseInt(month) - 1]}. ${year.slice(2)} р.`;
};

// Bottom Navigation - with labels
const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const navItems = [
    { path: "/", icon: TasksIcon, label: "завдання" },
    { path: "/smm", icon: SMMIcon, label: "smm" },
    { path: "/events", icon: EventsIcon, label: "події" },
    { path: "/stats", icon: StatsIcon, label: "аналітика" },
    { path: "/settings", icon: SettingsIcon, label: "налаштування" },
  ];

  const handleNavClick = (path) => {
    navigate(path);
    window.scrollTo(0, 0);
  };

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => (
        <button key={item.path} className={`nav-item ${location.pathname === item.path ? "active" : ""}`} onClick={() => handleNavClick(item.path)}>
          <item.icon className="w-5 h-5" />
          <span className="text-xs">{item.label}</span>
        </button>
      ))}
    </nav>
  );
};

// Fullscreen Modal Component for Desktop
const FullscreenModal = ({ isOpen, onClose, title, children }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#F6F5F1]">
      <div className="desktop-dashboard">
        <header className="desktop-header" style={{position: 'relative'}}>
          <div className="desktop-header-left">
            <span className="text-xl font-semibold">{title}</span>
          </div>
          <div className="desktop-header-right cursor-pointer" onClick={onClose} style={{marginRight: '-24px', paddingRight: '24px'}} data-testid="fullscreen-close-area">
            <div className="desktop-header-btn relative">
              <X className="w-5 h-5" />
              <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-xs text-secondary flex items-center gap-1 whitespace-nowrap pointer-events-none font-normal">або <kbd className="px-1.5 py-0.5 bg-[rgba(243,238,226,0.1)] rounded text-[10px] font-mono border border-[rgba(243,238,226,0.16)]">ESC</kbd> щоб закрити</span>
            </div>
            <div className="desktop-header-btn opacity-0 pointer-events-none"><FileText className="w-5 h-5" /></div>
            <div className="btn-dark opacity-0 pointer-events-none"><Plus className="w-4 h-4" /><span>подія</span></div>
            <div className="desktop-header-btn opacity-0 pointer-events-none"><Settings className="w-5 h-5" /></div>
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
};

// Task Item Component
const TaskItem = ({ task, onToggle, onEventClick, onStandaloneClick, showDate = false, isOverdue = false }) => {
  const IconComponent = task.icon ? getIconComponent(task.icon) : Circle;
  const [localCompleted, setLocalCompleted] = useState(task.completed);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => { setLocalCompleted(task.completed); setIsExiting(false); }, [task.completed, task.event_id, task.reminder_id]);

  const handleToggle = (checked) => {
    setLocalCompleted(checked);
    if (isOverdue && checked) {
      setTimeout(() => setIsExiting(true), 500);
      setTimeout(() => onToggle(task.event_id, task.reminder_id, checked, task.is_standalone), 1000);
    } else {
      onToggle(task.event_id, task.reminder_id, checked, task.is_standalone);
    }
  };

  const handleClick = () => {
    if (task.is_standalone && onStandaloneClick) onStandaloneClick(task);
    else if (!task.is_standalone && onEventClick) onEventClick(task.event_id);
  };

  return (
    <div className={`task-item transition-all duration-500 ${localCompleted ? "opacity-40" : ""} ${isExiting ? "opacity-0 -translate-x-4 h-0 py-0 overflow-hidden" : ""}`}>
      <div className={`task-icon ${task.color || ""}`}><IconComponent /></div>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={handleClick}>
        <p className="text-base font-medium">{task.reminder_name}</p>
        <p className="text-sm text-secondary lowercase">{task.event_title}</p>
        {task.target_month && <p className="text-xs text-gray-400">{UK_MONTHS[parseInt(task.target_month.split('-')[1]) - 1]}</p>}
      </div>
      {showDate && <span className="text-secondary text-sm whitespace-nowrap ml-2">{formatDateUkrainian(task.reminder_date)}</span>}
      <button className={`task-checkbox ${localCompleted ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); handleToggle(!localCompleted); }}>
        <Check className="w-4 h-4" />
      </button>
    </div>
  );
};

// SMM Task Item
// SMM Task Item with color support
const SMMTaskItem = ({ task, onToggle, onEventClick, onStandaloneClick, onEdit, onTaskEdit, onOverlapClick, showDate = false, smmTasksDefinition = [] }) => {
  // Determine icon - text work tasks get file icon
  const isTextWork = TEXT_WORK_SMM_TASKS.has(task.task_id);
  const iconName = task.icon || (task.is_standalone
    ? "instagram"
    : (isTextWork ? "file" : (SMM_ICONS[task.task_id] || "circle")));
  const IconComponent = getIconComponent(iconName);

  // Get task color - directly from task object (set by getSMMTasks)
  const taskColor = task.color || "manager";
  const colorClass = getColorClass(taskColor);

  const [localCompleted, setLocalCompleted] = useState(task.completed);

  useEffect(() => { setLocalCompleted(task.completed); }, [task.completed]);

  const handleToggle = () => {
    const newCompleted = !localCompleted;
    setLocalCompleted(newCompleted);
    onToggle(task.event_id, task.task_id, newCompleted, task.is_standalone);
  };

  const handleClick = () => {
    if (onTaskEdit) onTaskEdit(task);
    else if (task.is_standalone && onStandaloneClick) onStandaloneClick(task);
    else if (!task.is_standalone && onEventClick) onEventClick(task.event_id);
  };

  return (
    <div className={`task-item cursor-pointer ${localCompleted ? "opacity-40" : ""}`} onClick={handleClick} data-testid={`task-item-${task.task_id || task.event_id}`}>
      <div className={`task-icon ${colorClass}`}><IconComponent /></div>
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium truncate">{task.task_name}</p>
          {task.isOverlapping && (
            onOverlapClick ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOverlapClick(task); }}
                className="text-[10px] bg-red-100 text-red-600 hover:bg-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap transition-colors"
                title="клікни щоб перенести"
              >перетин</button>
            ) : (
              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full whitespace-nowrap" title="на цей день є інший анонс">перетин</span>
            )
          )}
        </div>
        {task.event_title && <p className="text-xs text-secondary lowercase truncate">{task.event_title}</p>}
        {task.target_month && <p className="text-xs text-gray-400">{UK_MONTHS[parseInt(task.target_month.split('-')[1]) - 1]}</p>}
      </div>
      {showDate && <span className="text-secondary text-xs whitespace-nowrap ml-1">{formatDateUkrainian(task.task_date)}</span>}
      <button className={`task-checkbox ${localCompleted ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); handleToggle(); }}>
        <Check className="w-4 h-4" />
      </button>
    </div>
  );
};

// Dialog that opens when user clicks the "перетин" badge.
// Suggests less-busy nearby dates to move the announcement to.
const OverlapResolverDialog = ({ task, open, onClose, onResolved }) => {
  const { events, standaloneTasks, smmTasksDefinition } = useApp();
  const currentDate = task?.task_date || task?.reminder_date;
  const taskName = task?.task_name || task?.reminder_name || "";
  const eventTitle = task?.event_title || "";

  // Tally tasks scheduled on a given date across all columns.
  const computeLoad = useCallback((dateStr) => {
    let announcements = 0, smm = 0, mgmt = 0, mktg = 0;
    const annIds = new Set((smmTasksDefinition || []).filter(s => s.is_announcement).map(s => s.id));
    (events || []).forEach(e => {
      if (e.cancelled || e.archived) return;
      Object.entries(e.smm_tasks || {}).forEach(([tid, d]) => {
        if (d === dateStr) {
          smm++;
          if (annIds.has(tid)) announcements++;
        }
      });
      Object.values(e.reminders || {}).forEach(d => { if (d === dateStr) mgmt++; });
      Object.values(e.marketing_tasks || {}).forEach(d => { if (d === dateStr) mktg++; });
    });
    (standaloneTasks || []).forEach(t => {
      if (t.date === dateStr && !t.completed) {
        if (t.assignee === 'smm') smm++;
        else if (t.assignee === 'marketer') mktg++;
        else mgmt++;
      }
    });
    return { announcements, smm, mgmt, mktg };
  }, [events, standaloneTasks, smmTasksDefinition]);

  const suggestions = useMemo(() => {
    if (!currentDate) return [];
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    const baseD = new Date(currentDate); baseD.setHours(0, 0, 0, 0);
    const out = [];
    for (let offset = -7; offset <= 14; offset++) {
      const d = new Date(baseD); d.setDate(d.getDate() + offset);
      if (d < todayD) continue;
      const dStr = formatDateLocal(d);
      if (dStr === currentDate) continue;
      const load = computeLoad(dStr);
      // Score: free-of-announcements is the dominant factor; then SMM density;
      // then proximity to original date.
      const score = (load.announcements === 0 ? 1000 : -1000 * load.announcements)
                  - load.smm * 8
                  - load.mgmt * 2
                  - Math.abs(offset) * 3;
      out.push({ date: dStr, dateObj: d, load, score, offset });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 7);
  }, [currentDate, computeLoad]);

  const currentLoad = currentDate ? computeLoad(currentDate) : null;

  const handleMove = async (newDate) => {
    if (!task) return;
    try {
      if (task.is_standalone) {
        // Standalone PATCH requires the full body — find the source task.
        const src = (standaloneTasks || []).find(t => t.id === (task.task_id || task.event_id));
        if (!src) throw new Error('standalone task not found');
        await axios.patch(`${API}/tasks/standalone/${src.id}`, {
          title: src.title,
          date: newDate,
          icon: src.icon,
          type: src.type,
          color: src.color,
          assignee: src.assignee,
        });
      } else {
        await axios.patch(`${API}/events/${task.event_id}/tasks/${task.task_id}`, { date: newDate });
      }
      toast.success('перенесено!');
      if (onResolved) onResolved();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error('не вдалось перенести');
    }
  };

  const dayShort = (d) => ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()];
  const totalOf = (load) => (load?.announcements || 0) + (load?.smm || 0) + (load?.mgmt || 0) + (load?.mktg || 0);

  // Single saturation reference for percentages: the busier of the current
  // date or any candidate, with a floor of 10 tasks so empty days really
  // look empty (otherwise scaling against e.g. max=2 would inflate light days).
  const loadBaseline = useMemo(() => {
    const totals = suggestions.map(s => totalOf(s.load));
    if (currentLoad) totals.push(totalOf(currentLoad));
    return Math.max(10, ...totals);
  }, [suggestions, currentLoad]);

  const loadPct = (load) => Math.min(100, Math.round((totalOf(load) / loadBaseline) * 100));
  // 0–33% calm green, 34–66% amber, 67%+ saturated red.
  const barColor = (pct) => pct >= 67 ? '#FF8370' : pct >= 34 ? '#C4703D' : '#3F8F4F';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="dialog-content max-w-md">
        <DialogHeader>
          <DialogTitle>перенести анонс</DialogTitle>
          <DialogDescription>
            «{taskName}»{eventTitle ? ` · ${eventTitle}` : ''}
          </DialogDescription>
        </DialogHeader>

        {currentLoad && (() => {
          const pct = loadPct(currentLoad);
          return (
            <div className="mt-3 p-3 rounded-2xl bg-red-50 border border-red-100">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-red-600 font-semibold">зараз</p>
                  <p className="text-sm font-medium text-[#1A1717]">{formatDateUkrainian(currentDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-red-600 font-medium">{currentLoad.announcements} анонсів цього дня</p>
                  <p className="text-[11px] text-secondary">завантаженість {pct}%</p>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-black/5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor(pct) }} />
              </div>
            </div>
          );
        })()}

        <p className="text-[10px] uppercase tracking-wide text-secondary font-semibold mt-4 mb-1">рекомендовані дні</p>
        <div className="space-y-1 max-h-[50vh] overflow-y-auto -mx-2 px-2">
          {suggestions.length === 0 && (
            <p className="text-sm text-secondary py-4 text-center">немає вільних днів у найближчі 2 тижні</p>
          )}
          {suggestions.map(s => {
            const free = s.load.announcements === 0;
            const pct = loadPct(s.load);
            return (
              <button
                key={s.date}
                onClick={() => handleMove(s.date)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-black/[0.04] transition-colors text-left"
                title={`${s.load.announcements} анонсів · ${totalOf(s.load)} тасків загалом`}
              >
                <div className="flex-shrink-0 w-11 text-center">
                  <div className="text-[10px] text-secondary uppercase tracking-wide">{dayShort(s.dateObj)}</div>
                  <div className="text-base font-semibold leading-tight">{s.dateObj.getDate()}</div>
                  <div className="text-[9px] text-secondary uppercase">{UK_MONTHS_SHORT[s.dateObj.getMonth()]}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {free ? (
                      <span className="inline-block text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">вільно</span>
                    ) : (
                      <span className="inline-block text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{s.load.announcements} анонсів</span>
                    )}
                    <span className="text-[11px] text-secondary tabular-nums">{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/5 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor(pct) }} />
                  </div>
                </div>
                <span className="text-xs text-secondary">→</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Dashboard Page (Mobile)
const Dashboard = () => {
  const { events, settings, standaloneTasks, smmTasksDefinition, refreshEvents, refreshStandaloneTasks } = useApp();
  const { pushUndo } = useUndo();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('events');
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [soonExpanded, setSoonExpanded] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archive, setArchive] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showEditCalendar, setShowEditCalendar] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskData, setNewTaskData] = useState(null);
  const [showNewTaskCalendar, setShowNewTaskCalendar] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayFormatted = formatDateWithWeekday(today);
  const todayStr = formatDateLocal(today);
  const twoWeeksFromNow = new Date(today); twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
  const twoWeeksStr = formatDateLocal(twoWeeksFromNow);

  const smmTasksMap = useMemo(() => { const map = {}; smmTasksDefinition.forEach(t => { map[t.id] = t; }); return map; }, [smmTasksDefinition]);

  // Regular tasks (reminders + non-SMM standalone)
  const getTasks = useCallback(() => {
    if (!settings?.reminder_types) return { overdue: [], today: [], soon: [] };
    const overdueTasks = [], todayTasks = [], soonTasks = [];
    const reminderMap = {}; settings.reminder_types.forEach(rt => { reminderMap[rt.id] = rt; });
    events.forEach(event => {
      if (event.cancelled) return;
      const eventDate = new Date(event.date); eventDate.setHours(0, 0, 0, 0);
      if (eventDate < today) return;
      Object.entries(event.reminders || {}).forEach(([reminderId, reminderDateStr]) => {
        const reminderInfo = reminderMap[reminderId]; if (!reminderInfo) return;
        const reminderDate = new Date(reminderDateStr); reminderDate.setHours(0, 0, 0, 0);
        const ov = (event.task_overrides || {})[reminderId] || {};
        const task = { event_id: event.id, event_title: event.title, reminder_id: reminderId, reminder_name: ov.title || reminderInfo.name, reminder_date: reminderDateStr, icon: ov.icon || reminderInfo.icon, completed: !!(event.completed_tasks || {})[reminderId], is_standalone: false, color: ov.color, assignee: normalizeAssignee(ov.assignee, ""), order: ov.order || 0 };
        if (reminderDateStr === todayStr) todayTasks.push(task);
        else if (reminderDate < today && !task.completed) overdueTasks.push(task);
        else if (reminderDate > today && reminderDateStr <= twoWeeksStr) soonTasks.push(task);
      });
    });
    standaloneTasks.filter(t => t.type !== "smm").forEach(task => {
      const taskDate = new Date(task.date); taskDate.setHours(0, 0, 0, 0);
      const linkedEvent = task.event_id ? events.find(event => event.id === task.event_id) : null;
      const t = { event_id: task.id, event_title: linkedEvent?.title || "", reminder_id: "standalone", reminder_name: task.title, reminder_date: task.date, icon: task.icon || "coffee", completed: task.completed, is_standalone: true, color: task.color || "manager", assignee: normalizeAssignee(task.assignee), target_month: task.target_month };
      if (task.date === todayStr) todayTasks.push(t);
      else if (taskDate < today && !task.completed) overdueTasks.push(t);
      else if (taskDate > today && task.date <= twoWeeksStr) soonTasks.push(t);
    });
    soonTasks.sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
    overdueTasks.sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
    return { overdue: overdueTasks, today: todayTasks, soon: soonTasks };
  }, [events, settings, standaloneTasks, today, todayStr, twoWeeksStr]);

  // SMM tasks
  const getSMMTasks = useCallback(() => {
    const overdueTasks = [], todayTasks = [], soonTasks = [];
    events.forEach(event => {
      if (event.cancelled) return;
      const eventDate = new Date(event.date); eventDate.setHours(0, 0, 0, 0);
      if (eventDate < today) return;
      Object.entries(event.smm_tasks || {}).forEach(([taskId, taskDateStr]) => {
        const taskInfo = smmTasksMap[taskId]; if (!taskInfo) return;
        const taskDate = new Date(taskDateStr); taskDate.setHours(0, 0, 0, 0);
        const ov = (event.task_overrides || {})[taskId] || {};
        const task = { event_id: event.id, event_title: event.title, task_id: taskId, task_name: ov.title || taskInfo.name, task_date: taskDateStr, completed: !!(event.completed_smm_tasks || {})[taskId], color: ov.color || taskInfo.color || "standard", icon: ov.icon || taskInfo.icon, assignee: normalizeAssignee(ov.assignee, "") };
        if (taskDateStr === todayStr) todayTasks.push(task);
        else if (taskDate < today && !task.completed) overdueTasks.push(task);
        else if (taskDate > today && taskDateStr <= twoWeeksStr) soonTasks.push(task);
      });
    });
    standaloneTasks.filter(t => t.type === "smm").forEach(task => {
      const taskDate = new Date(task.date); taskDate.setHours(0, 0, 0, 0);
      const linkedEvent = task.event_id ? events.find(event => event.id === task.event_id) : null;
      const t = { event_id: task.id, event_title: linkedEvent?.title || "", task_id: "standalone", task_name: task.title, task_date: task.date, icon: task.icon || "instagram", completed: task.completed, is_standalone: true, color: task.color || "manager", assignee: normalizeAssignee(task.assignee, "smm"), target_month: task.target_month };
      if (task.date === todayStr) todayTasks.push(t);
      else if (taskDate < today && !task.completed) overdueTasks.push(t);
      else if (taskDate > today && task.date <= twoWeeksStr) soonTasks.push(t);
    });
    soonTasks.sort((a, b) => new Date(a.task_date) - new Date(b.task_date));
    overdueTasks.sort((a, b) => new Date(a.task_date) - new Date(b.task_date));
    return { overdue: overdueTasks, today: todayTasks, soon: soonTasks };
  }, [events, smmTasksMap, standaloneTasks, today, todayStr, twoWeeksStr]);

  const regularTasks = getTasks();
  const allSmmTasks = getSMMTasks();

  // Team-based distribution (same as desktop)
  const tasksByTeam = useMemo(() => {
    const isManager = (t) => normalizeAssignee(t.assignee, "") === "manager";
    const isSMM = (t) => { if (t.assignee) return normalizeAssignee(t.assignee, "") === "smm"; if (t.is_standalone) return false; return normalizeAssignee(t.color, "") === "smm"; };
    const isMarketer = (t) => { if (t.assignee) return normalizeAssignee(t.assignee, "") === "marketer"; if (t.is_standalone) return false; return !isSMM(t) && !isManager(t); };
    const smmR = { overdue: [], today: [], soon: [] }, managerR = { overdue: [], today: [], soon: [] }, marketerR = { overdue: [], today: [], soon: [] };
    ['overdue', 'today', 'soon'].forEach(k => {
      regularTasks[k].forEach(t => {
        const assignee = normalizeAssignee(t.assignee);
        if (assignee === 'smm') smmR[k].push(t);
        else if (assignee === 'marketer') marketerR[k].push(t);
        else managerR[k].push(t);
      });
    });
    return {
      smm: { overdue: [...allSmmTasks.overdue.filter(isSMM), ...smmR.overdue], today: [...allSmmTasks.today.filter(isSMM), ...smmR.today], soon: [...allSmmTasks.soon.filter(isSMM), ...smmR.soon] },
      manager: { overdue: [...allSmmTasks.overdue.filter(isManager), ...managerR.overdue], today: [...allSmmTasks.today.filter(isManager), ...managerR.today], soon: [...allSmmTasks.soon.filter(isManager), ...managerR.soon] },
      marketer: { overdue: [...allSmmTasks.overdue.filter(isMarketer), ...marketerR.overdue], today: [...allSmmTasks.today.filter(isMarketer), ...marketerR.today], soon: [...allSmmTasks.soon.filter(isMarketer), ...marketerR.soon] },
    };
  }, [allSmmTasks, regularTasks]);

  const upcomingEvents = getVisibleEventsForMonth(events, currentMonth, today);

  const handleToggleTask = async (eventId, reminderId, completed, isStandalone) => {
    try {
      if (isStandalone) {
        await api.updateStandaloneTask(eventId, completed);
        pushUndo({ label: "таск", run: async () => { await api.updateStandaloneTask(eventId, !completed); refreshStandaloneTasks(); } });
        refreshStandaloneTasks();
      } else {
        await api.completeTask({ event_id: eventId, reminder_id: reminderId, completed });
        pushUndo({ label: "таск", run: async () => { await api.completeTask({ event_id: eventId, reminder_id: reminderId, completed: !completed }); refreshEvents(); } });
        refreshEvents();
      }
    } catch { toast.error("помилка"); }
  };
  const handleToggleSMMTask = async (eventId, taskId, completed, isStandalone) => {
    try {
      if (isStandalone) {
        await api.updateStandaloneTask(eventId, completed);
        pushUndo({ label: "таск", run: async () => { await api.updateStandaloneTask(eventId, !completed); refreshStandaloneTasks(); } });
        refreshStandaloneTasks();
      } else {
        await api.completeSMMTask({ event_id: eventId, task_id: taskId, completed });
        pushUndo({ label: "таск", run: async () => { await api.completeSMMTask({ event_id: eventId, task_id: taskId, completed: !completed }); refreshEvents(); } });
        refreshEvents();
      }
    } catch { toast.error("помилка"); }
  };
  const handleEventClick = (eventId) => { navigate(`/event/${eventId}/view`); };

  const handleTaskEdit = (task) => {
    if (task.is_standalone) {
      const fullTask = standaloneTasks.find(t => t.id === task.event_id);
      if (fullTask) {
        setEditingTask({...fullTask, _isStandalone: true, assignee: fullTask.assignee || task.assignee || 'manager'});
        setShowEditDialog(true);
      }
    } else {
      const currentAssignee = task.assignee || activeTab;
      setEditingTask({ _isStandalone: false, _eventId: task.event_id, _taskId: task.task_id || task.reminder_id, assignee: currentAssignee, id: task.event_id, title: task.task_name || task.reminder_name, date: task.task_date || task.reminder_date, icon: task.icon || "circle", color: task.color || "manager", type: "smm", completed: task.completed, eventTitle: task.event_title });
      setShowEditDialog(true);
    }
  };

  const handleSaveTask = async () => {
    if (!editingTask?.title?.trim()) return;
    const beforeStandalone = editingTask._isStandalone === false ? null : standaloneTasks.find(t => t.id === editingTask.id);
    const beforeEventTask = editingTask._isStandalone === false ? { ...editingTask } : null;
    try {
      if (editingTask._isStandalone === false) {
        await axios.patch(`${API}/events/${editingTask._eventId}/tasks/${editingTask._taskId}`, { color: editingTask.color, icon: editingTask.icon, title: editingTask.title, assignee: editingTask.assignee, date: editingTask.date });
        pushUndo({ label: "редагування таска", run: async () => { await api.updateEventTask(beforeEventTask._eventId, beforeEventTask._taskId, { color: beforeEventTask.color, icon: beforeEventTask.icon, title: beforeEventTask.title, assignee: beforeEventTask.assignee, date: beforeEventTask.date, order: beforeEventTask.order || 0 }); refreshEvents(); } });
        toast.success("збережено!"); refreshEvents();
      } else {
        await api.updateStandaloneTaskFull(editingTask.id, {
          title: editingTask.title,
          date: editingTask.date,
          icon: editingTask.icon,
          type: editingTask.type,
          color: editingTask.color,
          assignee: editingTask.assignee || 'manager',
          event_id: editingTask.event_id || "",
        });
        if (beforeStandalone) pushUndo({ label: "редагування таска", run: async () => { await api.updateStandaloneTaskFull(beforeStandalone.id, getStandaloneTaskPayload(beforeStandalone)); refreshStandaloneTasks(); } });
        toast.success("збережено!"); refreshStandaloneTasks();
      }
      setShowEditDialog(false); setEditingTask(null);
    } catch { toast.error("помилка"); }
  };

  const handleNewTaskOpen = () => {
    const isSMM = activeTab === 'smm' || activeTab === 'marketer';
    setNewTaskData({ title: '', date: todayStr, icon: isSMM ? 'instagram' : 'coffee', color: 'manager', assignee: activeTab, type: isSMM ? 'smm' : 'regular' });
    setShowNewTaskCalendar(false);
    setShowNewTask(true);
  };
  const handleCreateTask = async () => {
    if (!newTaskData?.title?.trim()) return;
    try {
      const r = await api.createStandaloneTask({ title: newTaskData.title, date: newTaskData.date, icon: newTaskData.icon, type: newTaskData.type === 'smm' ? 'smm' : undefined, color: newTaskData.color, assignee: newTaskData.assignee });
      if (r.data?.id) pushUndo({ label: "створення таска", run: async () => { await api.deleteStandaloneTask(r.data.id); refreshStandaloneTasks(); } });
      toast.success('створено!'); refreshStandaloneTasks(); setShowNewTask(false); setNewTaskData(null);
    } catch { toast.error('помилка'); }
  };

  const loadArchive = async () => { try { const r = await api.getTaskArchive(); setArchive(r.data); setShowArchive(true); } catch { toast.error("помилка"); } };

  // Render a task section (overdue/today/soon)
  const MobileTaskSection = ({ tasks: sectionTasks, title, isOverdue, isCollapsible, expanded, setExpanded }) => {
    if (isCollapsible && sectionTasks.length === 0) return null;
    const normalizeTask = (t) => ({ ...t, task_id: t.task_id || t.reminder_id, task_name: t.task_name || t.reminder_name, task_date: t.task_date || t.reminder_date, assignee: t.assignee || activeTab });
    return (
      <section className="mobile-section">
        {isCollapsible ? (
          <button className={`mobile-section-header ${isOverdue ? 'overdue' : ''} w-full text-left`} onClick={() => setExpanded(!expanded)}>
            <span>{title}</span>
            <span className="mobile-section-count">({sectionTasks.length})</span>
            <ChevronDown className={`w-5 h-5 ml-auto transition-transform ${isOverdue ? '' : 'text-secondary'} ${expanded ? "rotate-180" : ""}`} style={isOverdue ? { color: "#FF8370" } : {}} />
          </button>
        ) : (
          <div className="mobile-section-header"><span>{title}</span><span className="mobile-section-count">({sectionTasks.length})</span></div>
        )}
        {(!isCollapsible || expanded) && (
          sectionTasks.length > 0 ? (
            <div className="pt-3 space-y-1">
              {[...sectionTasks].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0)).map((t, i) => {
                const nt = normalizeTask(t);
                return <SMMTaskItem key={`${nt.event_id}-${nt.task_id}-${i}`} task={nt} onToggle={activeTab === 'manager' ? handleToggleTask : handleToggleSMMTask} onEventClick={handleEventClick} onTaskEdit={handleTaskEdit} smmTasksDefinition={smmTasksDefinition} showDate={isOverdue || title === 'незабаром'} />;
              })}
            </div>
          ) : <p className="text-secondary py-4 text-center text-sm">все зроблено!</p>
        )}
      </section>
    );
  };

  const currentTasks = activeTab === 'events' ? null : tasksByTeam[activeTab] || { overdue: [], today: [], soon: [] };
  const tabs = [
    { id: 'events', label: 'Події' },
    { id: 'manager', label: 'Manager' },
    { id: 'smm', label: 'SMM' },
    { id: 'marketer', label: 'Marketer' },
  ];

  return (
    <div className="animate-fade-in" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="px-5 pt-6 pb-3">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="logo text-xl" style={{ textTransform: 'none' }}>Poriadok</h1>
          <p className="text-sm text-secondary lowercase">{todayFormatted.weekday} • {todayFormatted.day} {todayFormatted.month}</p>
        </div>
        <div className="flex gap-1.5 justify-end pb-1" data-testid="mobile-tabs">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setOverdueExpanded(false); setSoonExpanded(false); }} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab.id ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[rgba(0,0,0,0.05)] text-[#1A1717]'}`} data-testid={`tab-${tab.id}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-3">
        {activeTab === 'events' ? (
          <>
            <div className="calendar-container-desktop mb-2">
              <Calendar mode="single" locale={uk} weekStartsOn={1} month={currentMonth} onMonthChange={setCurrentMonth} className="w-full calendar-minimal !p-1"
                classNames={{ month: "space-y-0 w-full", caption: "flex justify-center items-center py-1", caption_label: "text-sm font-medium", row: "flex w-full", head_row: "flex w-full", table: "w-full border-collapse", nav_button: "w-7 h-7 bg-transparent hover:bg-black/5 rounded-full flex items-center justify-center" }}
                modifiersClassNames={{ today: "calendar-today-visible" }}
                components={{ DayContent: ({ date }) => {
                  return renderEventCalendarDay(date, events, currentMonth, today);
                }}}
              />
            </div>
            {upcomingEvents.length > 0 ? upcomingEvents.map(event => (
              <div key={event.id} className={`event-card-desktop cursor-pointer${getEventArchiveClass(event, today)}`} onClick={() => handleEventClick(event.id)} data-testid={`mobile-event-${event.id}`}>
                <div className="flex items-center gap-3">
                  <div className="date-badge-desktop"><span className="text-[9px] uppercase">{UK_MONTHS_SHORT[new Date(event.date).getMonth()]}</span><span className="text-base font-bold">{new Date(event.date).getDate()}</span></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold truncate">{event.title}</h3>
                    <p className="text-xs text-secondary">{event.start_time && `${event.start_time} • `}{event.price} ₴</p>
                  </div>
                  <EventArchiveIcon event={event} today={today} />
                  {event.altegio_booked_count != null && (
                    <div className="text-right">
                      <span className={`text-base font-bold ${getBookingColorClass(getBookingStatusColor(event))}`}>{event.altegio_booked_count}</span>
                      <span className="text-xs text-secondary">/{event.spots}</span>
                    </div>
                  )}
                </div>
              </div>
            )) : <p className="text-secondary text-center py-8 text-sm">поки подій немає</p>}
          </>
        ) : (
          <>
            <MobileTaskSection tasks={currentTasks.overdue} title="протерміновано" isOverdue isCollapsible expanded={overdueExpanded} setExpanded={setOverdueExpanded} />
            <MobileTaskSection tasks={currentTasks.today} title="сьогодні" />
            <MobileTaskSection tasks={currentTasks.soon} title="незабаром" isCollapsible expanded={soonExpanded} setExpanded={setSoonExpanded} />
          </>
        )}
      </div>

      {activeTab !== 'events' && (
        <button className="fab" onClick={handleNewTaskOpen} data-testid="mobile-fab">
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Edit task dialog */}
      {showEditDialog && editingTask && (() => {
        const COLOR_MAP = {'manager':'#1A1717','red':'#FF8370','purple':'#9333EA','blue':'#3B82F6','orange':'#C4703D','emerald':'#059669','teal':'#14B8A6','smm':'#059669','pink':'#FF8370'};
        const selectedHex = COLOR_MAP[editingTask.color] || '#1A1717';
        const linkedEventTitle = editingTask.eventTitle || (editingTask.event_id ? events.find(e => e.id === editingTask.event_id)?.title : '');
        const editDateChips = [
          { label: 'сьогодні', value: todayStr },
          { label: 'завтра', value: shiftDateLocal(todayStr, 1) },
          { label: '+2д', value: shiftDateLocal(todayStr, 2) },
          { label: '+3д', value: shiftDateLocal(todayStr, 3) },
          { label: '+1 тиж', value: shiftDateLocal(todayStr, 7) },
        ];
        return (
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="dialog-content mobile-task-dialog max-w-[calc(100vw-24px)] sm:max-w-sm !p-5" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader className="pr-10">
              <DialogTitle className="text-[20px] leading-tight">завдання</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 text-xs lowercase">
                <span className="relative inline-flex items-center">
                  <select value={editingTask.assignee || 'manager'} onChange={(e) => setEditingTask({...editingTask, assignee: e.target.value})} className="appearance-none bg-transparent font-semibold outline-none cursor-pointer pr-4 uppercase tracking-wide">
                    <option value="manager">Manager</option><option value="smm">SMM</option><option value="marketer">Marketer</option>
                  </select>
                  <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-secondary" />
                </span>
                {linkedEventTitle && <span className="truncate">· {linkedEventTitle}</span>}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-3">
              <Input placeholder="що треба зробити?" value={editingTask.title} onChange={(e) => setEditingTask({...editingTask, title: e.target.value})} className="form-input text-base h-12" data-testid="mobile-edit-input" />
              <div className="grid grid-cols-5 gap-1.5">
                {editDateChips.map(chip => (
                  <button key={chip.value} type="button" className={`mobile-date-chip ${editingTask.date === chip.value ? 'selected' : ''}`} onClick={() => setEditingTask({...editingTask, date: chip.value})}>{chip.label}</button>
                ))}
              </div>
              <button type="button" className="mobile-date-wide" onClick={() => setShowEditCalendar(!showEditCalendar)}><CalendarIcon className="w-4 h-4" />{formatDateUkrainian(editingTask.date)}</button>
              {showEditCalendar && <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(editingTask.date)} onSelect={(d) => { if (d) { setEditingTask({...editingTask, date: formatDateLocal(d)}); } setShowEditCalendar(false); }} className="w-full" />}
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#E8E5DC]/45 px-3 py-2">
                <span className="text-[11px] uppercase tracking-wide text-secondary font-semibold">колір</span>
                <div className="flex gap-2">
                  {["manager", "red", "purple", "blue", "orange", "emerald", "teal"].map(c => (
                    <button key={c} onClick={() => setEditingTask({...editingTask, color: c})} className={`color-circle-perfect ${editingTask.color === c ? 'ring-2 ring-offset-1 ring-current' : ''}`} style={{ background: COLOR_MAP[c] || '#1A1717' }} aria-label={c} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {TASK_ICONS.map(opt => { const IC = getIconComponent(opt.value); return (
                  <button key={opt.value} className={`icon-selector-btn ${editingTask.icon === opt.value ? 'selected' : ''}`} style={{color: selectedHex}} onClick={() => setEditingTask({...editingTask, icon: opt.value})} aria-label={opt.value}><IC /></button>
                ); })}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {editingTask._isStandalone && (
                  <button className="h-11 text-sm rounded-full border border-red-200 text-red-600" onClick={async () => { const before = { ...editingTask }; try { await api.deleteStandaloneTask(editingTask.id); pushUndo({ label: "видалення таска", run: async () => { await api.createStandaloneTask(getStandaloneTaskPayload(before)); refreshStandaloneTasks(); } }); toast.success("видалено!"); refreshStandaloneTasks(); setShowEditDialog(false); } catch { toast.error("помилка"); } }} data-testid="mobile-edit-delete"><Trash2 className="w-4 h-4 inline mr-1" />видалити</button>
                )}
                <button className={`btn-dark h-11 text-sm ${editingTask._isStandalone ? '' : 'col-span-2'}`} onClick={handleSaveTask} data-testid="mobile-edit-save">зберегти</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        );
      })()}

      {/* New task dialog */}
      {showNewTask && newTaskData && (() => {
        const COLOR_MAP = {'manager':'#1A1717','red':'#FF8370','purple':'#9333EA','blue':'#3B82F6','orange':'#C4703D','emerald':'#059669','teal':'#14B8A6','smm':'#059669','pink':'#FF8370'};
        const selectedHex = COLOR_MAP[newTaskData.color] || '#1A1717';
        const newDateChips = [
          { label: 'сьогодні', value: todayStr },
          { label: 'завтра', value: shiftDateLocal(todayStr, 1) },
          { label: '+2д', value: shiftDateLocal(todayStr, 2) },
          { label: '+3д', value: shiftDateLocal(todayStr, 3) },
          { label: '+1 тиж', value: shiftDateLocal(todayStr, 7) },
        ];
        return (
        <Dialog open={showNewTask} onOpenChange={setShowNewTask}>
          <DialogContent className="dialog-content mobile-task-dialog max-w-[calc(100vw-24px)] sm:max-w-sm !p-5" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader className="pr-10">
              <DialogTitle className="text-[20px] leading-tight">нове завдання</DialogTitle>
              <DialogDescription className="relative inline-flex items-center text-xs lowercase">
                <select value={newTaskData.assignee} onChange={(e) => setNewTaskData({...newTaskData, assignee: e.target.value})} className="appearance-none bg-transparent font-semibold outline-none cursor-pointer pr-4 uppercase tracking-wide">
                  <option value="manager">Manager</option><option value="smm">SMM</option><option value="marketer">Marketer</option>
                </select>
                <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-secondary" />
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-3">
              <Input autoFocus placeholder="що треба зробити?" value={newTaskData.title} onChange={(e) => setNewTaskData({...newTaskData, title: e.target.value})} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCreateTask(); }} className="form-input text-base h-12" data-testid="mobile-new-input" />
              <div className="grid grid-cols-5 gap-1.5">
                {newDateChips.map(chip => (
                  <button key={chip.value} type="button" className={`mobile-date-chip ${newTaskData.date === chip.value ? 'selected' : ''}`} onClick={() => setNewTaskData({...newTaskData, date: chip.value})}>{chip.label}</button>
                ))}
              </div>
              <button type="button" className="mobile-date-wide" onClick={() => setShowNewTaskCalendar(!showNewTaskCalendar)}><CalendarIcon className="w-4 h-4" />{formatDateUkrainian(newTaskData.date)}</button>
              {showNewTaskCalendar && <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(newTaskData.date)} onSelect={(d) => { if (d) { setNewTaskData({...newTaskData, date: formatDateLocal(d)}); } setShowNewTaskCalendar(false); }} className="w-full" />}
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#E8E5DC]/45 px-3 py-2">
                <span className="text-[11px] uppercase tracking-wide text-secondary font-semibold">колір</span>
                <div className="flex gap-2">
                  {["manager", "red", "purple", "blue", "orange", "emerald", "teal"].map(c => (
                    <button key={c} onClick={() => setNewTaskData({...newTaskData, color: c})} className={`color-circle-perfect ${newTaskData.color === c ? 'ring-2 ring-offset-1 ring-current' : ''}`} style={{ background: COLOR_MAP[c] || '#1A1717' }} aria-label={c} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {TASK_ICONS.map(opt => { const IC = getIconComponent(opt.value); return (
                  <button key={opt.value} className={`icon-selector-btn ${newTaskData.icon === opt.value ? 'selected' : ''}`} style={{color: selectedHex}} onClick={() => setNewTaskData({...newTaskData, icon: opt.value})} aria-label={opt.value}><IC /></button>
                ); })}
              </div>
              <button className="btn-dark w-full h-11 text-sm" onClick={handleCreateTask} data-testid="mobile-new-save">створити</button>
            </div>
          </DialogContent>
        </Dialog>
        );
      })()}
    </div>
  );
};

// New Task Page (Mobile fullscreen)
const NewTaskPage = () => {
  const navigate = useNavigate();
  const { refreshStandaloneTasks } = useApp();
  const [newTask, setNewTask] = useState({ title: "", date: formatDateLocal(new Date()), icon: "coffee" });
  const [showCalendar, setShowCalendar] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) return;
    setLoading(true);
    try {
      await api.createStandaloneTask(newTask);
      toast.success("додано!");
      refreshStandaloneTasks();
      navigate(-1);
    } catch {
      toast.error("помилка");
    } finally {
      setLoading(false);
    }
  };

  const SelectedIcon = getIconComponent(newTask.icon);

  return (
    <div className="animate-fade-in min-h-screen bg-[#F6F5F1]">
      <header className="page-header-back">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="page-title text-center flex-1">нове завдання</h1>
        <div className="w-10" />
      </header>

      <div className="page-content pt-8 space-y-6">
        <div className="space-y-4">
          <div className="form-field">
            <Label className="text-sm text-secondary">що треба зробити?</Label>
            <Input
              placeholder="назва завдання"
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              className="form-input text-lg"
              autoFocus
            />
          </div>

          <div className="form-field">
            <Label className="text-sm text-secondary">іконка</Label>
            <button
              type="button"
              className="form-input w-full text-left flex items-center gap-3"
              onClick={() => setShowIconPicker(true)}
            >
              <div className="w-8 h-8 rounded-full bg-[#1A1717] flex items-center justify-center">
                <SelectedIcon className="w-4 h-4 text-[#F6F5F1]" />
              </div>
              <span className="text-secondary">змінити іконку</span>
            </button>
          </div>

          <div className="form-field">
            <Label className="text-sm text-secondary">дата</Label>
            <button
              type="button"
              className="form-input w-full text-left flex items-center justify-between"
              onClick={() => setShowCalendar(true)}
            >
              <span>{formatDateUkrainian(newTask.date)}</span>
              <CalendarIcon className="w-5 h-5 text-secondary" />
            </button>
          </div>
        </div>

        <button
          className="btn-dark w-full h-14 text-lg"
          onClick={handleCreateTask}
          disabled={loading || !newTask.title.trim()}
        >
          {loading ? "додаю..." : "додати завдання"}
        </button>
      </div>

      <Dialog open={showCalendar} onOpenChange={setShowCalendar}>
        <DialogContent className="dialog-content">
          <Calendar
            mode="single"
            locale={uk}
            weekStartsOn={1}
            selected={new Date(newTask.date)}
            onSelect={(d) => {
              if (d) setNewTask({ ...newTask, date: formatDateLocal(d) });
              setShowCalendar(false);
            }}
            className="w-full"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showIconPicker} onOpenChange={setShowIconPicker}>
        <DialogContent className="dialog-content">
          <DialogHeader><DialogTitle>обери іконку</DialogTitle></DialogHeader>
          <div className="grid grid-cols-6 gap-2 pt-4">
            {CUSTOM_TASK_ICONS.map(({ value, Icon }) => (
              <button
                key={value}
                className={`icon-selector-btn ${newTask.icon === value ? 'selected' : ''}`}
                onClick={() => { setNewTask({ ...newTask, icon: value }); setShowIconPicker(false); }}
              >
                <Icon className="w-5 h-5" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// New SMM Task Page (Mobile fullscreen)
const NewSMMTaskPage = () => {
  const navigate = useNavigate();
  const { refreshStandaloneTasks } = useApp();
  const [newTask, setNewTask] = useState({ title: "", date: formatDateLocal(new Date()), icon: "instagram", type: "smm" });
  const [showCalendar, setShowCalendar] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) return;
    setLoading(true);
    try {
      await api.createStandaloneTask(newTask);
      toast.success("додано!");
      refreshStandaloneTasks();
      navigate(-1);
    } catch {
      toast.error("помилка");
    } finally {
      setLoading(false);
    }
  };

  const SelectedIcon = getIconComponent(newTask.icon);

  return (
    <div className="animate-fade-in min-h-screen bg-[#F6F5F1]">
      <header className="page-header-back">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="page-title text-center flex-1">нове smm завдання</h1>
        <div className="w-10" />
      </header>

      <div className="page-content pt-8 space-y-6">
        <div className="space-y-4">
          <div className="form-field">
            <Label className="text-sm text-secondary">що треба зробити?</Label>
            <Input
              placeholder="назва завдання"
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              className="form-input text-lg"
              autoFocus
            />
          </div>

          <div className="form-field">
            <Label className="text-sm text-secondary">іконка</Label>
            <button
              type="button"
              className="form-input w-full text-left flex items-center gap-3"
              onClick={() => setShowIconPicker(true)}
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#1A1717]">
                <SelectedIcon className="w-4 h-4 text-[#F6F5F1]" />
              </div>
              <span className="text-secondary">змінити іконку</span>
            </button>
          </div>

          <div className="form-field">
            <Label className="text-sm text-secondary">дата</Label>
            <button
              type="button"
              className="form-input w-full text-left flex items-center justify-between"
              onClick={() => setShowCalendar(true)}
            >
              <span>{formatDateUkrainian(newTask.date)}</span>
              <CalendarIcon className="w-5 h-5 text-secondary" />
            </button>
          </div>
        </div>

        <button
          className="w-full h-14 text-lg rounded-full font-medium transition-colors flex items-center justify-center gap-2 bg-[#1A1717] hover:bg-[#333333] text-[#F6F5F1]"
          onClick={handleCreateTask}
          disabled={loading || !newTask.title.trim()}
        >
          {loading ? "додаю..." : "додати завдання"}
        </button>
      </div>

      <Dialog open={showCalendar} onOpenChange={setShowCalendar}>
        <DialogContent className="dialog-content">
          <Calendar
            mode="single"
            locale={uk}
            weekStartsOn={1}
            selected={new Date(newTask.date)}
            onSelect={(d) => {
              if (d) setNewTask({ ...newTask, date: formatDateLocal(d) });
              setShowCalendar(false);
            }}
            className="w-full"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showIconPicker} onOpenChange={setShowIconPicker}>
        <DialogContent className="dialog-content">
          <DialogHeader><DialogTitle>обери іконку</DialogTitle></DialogHeader>
          <div className="grid grid-cols-5 gap-2 pt-4">
            {SMM_TASK_ICONS.map(({ value, Icon }) => (
              <button
                key={value}
                className={`icon-selector-btn ${newTask.icon === value ? 'selected' : ''}`}
                onClick={() => { setNewTask({ ...newTask, icon: value }); setShowIconPicker(false); }}
              >
                <Icon className="w-5 h-5" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Events Page
const EventsPage = () => {
  const { events, settings, refreshEvents } = useApp();
  const { pushUndo } = useUndo();
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showArchive, setShowArchive] = useState(false);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allEvents = getVisibleEventsForMonth(events, currentMonth, today);

  // Archive: cancelled events + past events + archived events
  const archivedEvents = events.filter(e => {
    const eventDate = new Date(e.date);
    eventDate.setHours(0, 0, 0, 0);
    return e.cancelled || e.archived || eventDate < today;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const handleDateSelect = (date) => {
    if (date) {
      const dateStr = formatDateLocal(date);
      const element = document.querySelector(`[data-event-date="${dateStr}"]`);
      if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); element.classList.add('event-highlight'); setTimeout(() => element.classList.remove('event-highlight'), 2000); }
    }
  };

  const handleEventClick = (event) => { setSelectedEvent(event); setShowEventDialog(true); };
  const handleDeleteEvent = async () => {
    await deleteEventPermanentlyFlow(selectedEvent, {
      refreshEvents,
      onDeleted: () => { setShowEventDialog(false); setDeleteDialogOpen(false); },
      onCancelled: () => { setShowEventDialog(false); setDeleteDialogOpen(false); },
    });
  };
  const handleToggleTaskInDialog = async (reminderId, completed) => {
    try { await api.completeTask({ event_id: selectedEvent.id, reminder_id: reminderId, completed }); refreshEvents(); const r = await axios.get(`${API}/events/${selectedEvent.id}`); setSelectedEvent(r.data); }
    catch { toast.error("помилка"); }
  };

  const handleRestoreEvent = async (eventId) => {
    try {
      await axios.patch(`${API}/events/${eventId}`, { cancelled: false });
      pushUndo({ label: "відновлення події", run: async () => { await axios.patch(`${API}/events/${eventId}`, { cancelled: true }); refreshEvents(); } });
      toast.success("подію відновлено");
      refreshEvents();
    } catch { toast.error("помилка"); }
  };

  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <h1 className="logo">події</h1>
      </header>

      <div className="page-content pt-4">
        <div className="calendar-container mb-6">
          <Calendar mode="single" locale={uk} weekStartsOn={1} onSelect={handleDateSelect} month={currentMonth} onMonthChange={setCurrentMonth} className="w-full calendar-minimal"
            modifiersClassNames={{ today: "calendar-today-hidden" }}
            components={{ DayContent: ({ date }) => {
              return renderEventCalendarDay(date, events, currentMonth, today);
            }}}
          />
        </div>

        <section>
          <div className="section-header mb-3"><span className="section-title">всі події</span></div>
          {allEvents.length > 0 ? (
            <div className="space-y-3">{allEvents.map(event => (
              <div key={event.id} className={`event-card flex items-center gap-4${getEventArchiveClass(event, today)}`} onClick={() => navigate(`/event/${event.id}/view`)} data-event-date={event.date.split('T')[0]}>
                <div className="date-badge"><span className="text-xs">{UK_MONTHS_SHORT[new Date(event.date).getMonth()]}</span><span className="text-lg font-bold">{new Date(event.date).getDate()}</span></div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{event.title}</h3>
                  <p className="text-sm text-secondary">{event.spots} місць • {event.price} ₴</p>
                </div>
                <EventArchiveIcon event={event} today={today} />
                {event.altegio_booked_count !== undefined && event.altegio_booked_count !== null && (
                  <div className="text-right">
                    <span className={`text-lg font-bold ${getBookingColorClass(getBookingStatusColor(event))}`}>
                      {event.altegio_booked_count}
                    </span>
                    <span className="text-sm text-secondary">/{event.spots}</span>
                  </div>
                )}
              </div>
            ))}</div>
          ) : <div className="text-center py-12"><p className="text-secondary text-sm">поки подій немає</p><button className="btn-dark mt-4" onClick={() => navigate("/event/new")}><Plus className="w-4 h-4 mr-2" />створити</button></div>}
        </section>

        <button className="archive-btn" onClick={() => setShowArchive(true)}><Archive className="w-4 h-4 inline mr-2" />архів подій</button>
      </div>

      <button className="fab" onClick={() => navigate("/event/new")}><Plus className="w-6 h-6" /></button>

      <Dialog open={showArchive} onOpenChange={setShowArchive}>
        <DialogContent className="dialog-content"><DialogHeader><DialogTitle>архів подій</DialogTitle></DialogHeader>
          {archivedEvents.length > 0 ? <div className="space-y-3">{archivedEvents.map(event => (
            <div key={event.id} className="event-card flex items-center gap-4">
              <div className="date-badge"><span className="text-xs">{UK_MONTHS_SHORT[new Date(event.date).getMonth()]}</span><span className="text-lg font-bold">{new Date(event.date).getDate()}</span></div>
              <div className="flex-1 min-w-0"><h3 className="font-semibold truncate">{event.title}</h3><p className="text-sm text-secondary">{event.price} ₴</p></div>
              {event.cancelled ? (
                <button className="restore-btn cancelled" onClick={() => handleRestoreEvent(event.id)} title="відновити">
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <span className="text-xs text-secondary">минула</span>
              )}
            </div>
          ))}</div> : <p className="text-center text-secondary py-8 text-sm">порожньо</p>}
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
};

// SMM Page
const SMMPage = () => {
  const { events, smmTasksDefinition, refreshEvents, standaloneTasks, refreshStandaloneTasks } = useApp();
  const navigate = useNavigate();
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [soonExpanded, setSoonExpanded] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayStr = formatDateLocal(today);
  const weekFromNow = new Date(today); weekFromNow.setDate(weekFromNow.getDate() + 7);
  const weekFromNowStr = formatDateLocal(weekFromNow);

  const smmTasksMap = useMemo(() => { const map = {}; smmTasksDefinition.forEach(t => { map[t.id] = t; }); return map; }, [smmTasksDefinition]);

  // Collect completed SMM tasks from events
  const completedSMMTasks = useMemo(() => {
    const completed = [];
    events.forEach(event => {
      Object.entries(event.completed_smm_tasks || {}).forEach(([taskId, isCompleted]) => {
        if (isCompleted) {
          const taskInfo = smmTasksMap[taskId];
          if (taskInfo) {
            completed.push({
              event_id: event.id,
              event_title: event.title,
              task_id: taskId,
              task_name: taskInfo.name,
              icon: SMM_ICONS[taskId] || "instagram"
            });
          }
        }
      });
    });
    return completed;
  }, [events, smmTasksMap]);

  const getAllSMMTasks = useCallback(() => {
    const overdueTasks = [], todayTasks = [], soonTasks = [];
    events.forEach(event => {
      if (event.cancelled) return;
      const eventDate = new Date(event.date); eventDate.setHours(0, 0, 0, 0);
      if (eventDate < today) return;

      Object.entries(event.smm_tasks || {}).forEach(([taskId, taskDateStr]) => {
        const taskInfo = smmTasksMap[taskId]; if (!taskInfo) return;
        const taskDate = new Date(taskDateStr); taskDate.setHours(0, 0, 0, 0);
        const ov1 = (event.task_overrides || {})[taskId] || {};
        const taskColor = ov1.color || taskInfo.color || "standard";
        const task = { event_id: event.id, event_title: event.title, task_id: taskId, task_name: ov1.title || taskInfo.name, task_date: taskDateStr, completed: !!(event.completed_smm_tasks || {})[taskId], color: taskColor, icon: ov1.icon || taskInfo.icon, assignee: ov1.assignee };

        if (taskDateStr === todayStr) todayTasks.push(task);
        else if (taskDate < today && !task.completed) overdueTasks.push(task);
        else if (taskDate > today && taskDateStr <= weekFromNowStr) soonTasks.push(task);
      });
    });
    soonTasks.sort((a, b) => new Date(a.task_date) - new Date(b.task_date));
    overdueTasks.sort((a, b) => new Date(a.task_date) - new Date(b.task_date));
    return { overdue: overdueTasks, today: todayTasks, soon: soonTasks };
  }, [events, smmTasksMap, todayStr, weekFromNowStr, today]);

  const allTasks = getAllSMMTasks();

  // Split SMM tasks (smm) from other (marketer)
  const tasksSMM = useMemo(() => ({
    overdue: allTasks.overdue.filter(t => t.assignee === "smm" || t.color === "smm"),
    today: allTasks.today.filter(t => t.assignee === "smm" || t.color === "smm"),
    soon: allTasks.soon.filter(t => t.assignee === "smm" || t.color === "smm"),
  }), [allTasks]);

  const tasks = useMemo(() => ({
    overdue: allTasks.overdue.filter(t => t.color !== "emerald"),
    today: allTasks.today.filter(t => t.color !== "emerald"),
    soon: allTasks.soon.filter(t => t.color !== "emerald"),
  }), [allTasks]);
  const handleToggleSMMTask = async (eventId, taskId, completed) => { try { await api.completeSMMTask({ event_id: eventId, task_id: taskId, completed }); refreshEvents(); } catch { toast.error("помилка"); } };
  const handleEventClick = (eventId) => { navigate(`/event/${eventId}`); };

  const handleRestoreSMMTask = async (item) => {
    try {
      await api.completeSMMTask({ event_id: item.event_id, task_id: item.task_id, completed: false });
      refreshEvents();
      toast.success("відновлено");
    } catch { toast.error("помилка"); }
  };

  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <h1 className="logo">smm</h1>
      </header>

      <div className="page-content space-y-4 pt-4">
        {/* SMM SMM Block (Emerald tasks) */}
        <div className="pb-4">
          <h2 className="text-sm font-semibold tracking-wide text-[#1A1717]/70 mb-3 px-1">SMM</h2>

          {tasksSMM.overdue.length > 0 && (
            <section className="mobile-section mb-3">
              <button className="mobile-section-header overdue w-full text-left" onClick={() => setOverdueExpanded(!overdueExpanded)}>
                <span>протерміновано</span>
                <span className="mobile-section-count">({tasksSMM.overdue.length})</span>
                <ChevronDown className={`w-5 h-5 ml-auto transition-transform ${overdueExpanded ? "rotate-180" : ""}`} style={{ color: "#FF8370" }} />
              </button>
              {overdueExpanded && <div className="animate-fade-in pt-4 space-y-3">{tasksSMM.overdue.map(t => <SMMTaskItem key={`${t.event_id}-${t.task_id}`} task={t} onToggle={handleToggleSMMTask} onEventClick={handleEventClick} showDate />)}</div>}
            </section>
          )}

          <section className="mobile-section mb-3">
            <div className="mobile-section-header">
              <span>сьогодні</span>
              <span className="mobile-section-count">({tasksSMM.today.length})</span>
            </div>
            {tasksSMM.today.length > 0 ? <div className="pt-4 space-y-3">{tasksSMM.today.map(t => <SMMTaskItem key={`${t.event_id}-${t.task_id}`} task={t} onToggle={handleToggleSMMTask} onEventClick={handleEventClick} />)}</div>
              : <p className="text-secondary py-4 text-center text-sm">все зроблено! 🎉</p>}
          </section>

          {tasksSMM.soon.length > 0 && (
            <section className="mobile-section">
              <button className="mobile-section-header w-full text-left" onClick={() => setSoonExpanded(!soonExpanded)}>
                <span>незабаром</span>
                <span className="mobile-section-count">({tasksSMM.soon.length})</span>
                <ChevronDown className={`w-5 h-5 ml-auto transition-transform text-secondary ${soonExpanded ? "rotate-180" : ""}`} />
              </button>
              {soonExpanded && <div className="animate-fade-in pt-4 space-y-3">{tasksSMM.soon.map(t => <SMMTaskItem key={`${t.event_id}-${t.task_id}`} task={t} onToggle={handleToggleSMMTask} onEventClick={handleEventClick} showDate />)}</div>}
            </section>
          )}
        </div>

        {/* Divider */}
        <div className="border-t-2 border-gray-300 my-5"></div>

        {/* SMM Block (Standard tasks) */}
        <div className="pt-1">
          <h2 className="text-sm font-semibold tracking-wide text-secondary mb-3 px-1">SMM</h2>

          {tasks.overdue.length > 0 && (
            <section className="mobile-section mb-3">
              <button className="mobile-section-header overdue w-full text-left" onClick={() => setOverdueExpanded(!overdueExpanded)}>
                <span>протерміновано</span>
                <span className="mobile-section-count">({tasks.overdue.length})</span>
                <ChevronDown className={`w-5 h-5 ml-auto transition-transform ${overdueExpanded ? "rotate-180" : ""}`} style={{ color: "#FF8370" }} />
              </button>
              {overdueExpanded && <div className="animate-fade-in pt-4 space-y-3">{tasks.overdue.map(t => <SMMTaskItem key={`${t.event_id}-${t.task_id}`} task={t} onToggle={handleToggleSMMTask} onEventClick={handleEventClick} showDate />)}</div>}
            </section>
          )}

          <section className="mobile-section mb-3">
            <div className="mobile-section-header">
              <span>сьогодні</span>
              <span className="mobile-section-count">({tasks.today.length})</span>
            </div>
            {tasks.today.length > 0 ? <div className="pt-4 space-y-3">{tasks.today.map(t => <SMMTaskItem key={`${t.event_id}-${t.task_id}`} task={t} onToggle={handleToggleSMMTask} onEventClick={handleEventClick} />)}</div>
              : <p className="text-secondary py-4 text-center text-sm">все зроблено! 🎉</p>}
          </section>

          {tasks.soon.length > 0 && (
            <section className="mobile-section">
              <button className="mobile-section-header w-full text-left" onClick={() => setSoonExpanded(!soonExpanded)}>
                <span>незабаром</span>
                <span className="mobile-section-count">({tasks.soon.length})</span>
                <ChevronDown className={`w-5 h-5 ml-auto transition-transform text-secondary ${soonExpanded ? "rotate-180" : ""}`} />
              </button>
              {soonExpanded && <div className="animate-fade-in pt-4 space-y-3">{tasks.soon.map(t => <SMMTaskItem key={`${t.event_id}-${t.task_id}`} task={t} onToggle={handleToggleSMMTask} onEventClick={handleEventClick} showDate />)}</div>}
            </section>
          )}
        </div>

        {allTasks.overdue.length === 0 && allTasks.today.length === 0 && allTasks.soon.length === 0 && <div className="text-center py-12"><p className="text-secondary text-sm">поки SMM завдань немає</p></div>}

        <button className="archive-btn" onClick={() => setShowArchive(true)}><Archive className="w-4 h-4 inline mr-2" />архів smm</button>
      </div>

      <button className="fab" onClick={() => navigate('/smm/task/new')}><Plus className="w-6 h-6" /></button>

      <Dialog open={showArchive} onOpenChange={setShowArchive}>
        <DialogContent className="dialog-content max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>архів smm</DialogTitle></DialogHeader>
          {completedSMMTasks.length > 0 ? <div className="space-y-1">{completedSMMTasks.map((item, idx) => {
            const IconComponent = getIconComponent(item.icon || "instagram");
            return (
              <div key={idx} className="task-item">
                <div className="task-icon"><IconComponent /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-medium">{item.task_name}</p>
                  <p className="text-sm text-secondary">{item.event_title}</p>
                </div>
                <button className="restore-btn" onClick={() => handleRestoreSMMTask(item)} title="відновити">
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            );
          })}</div> : <p className="text-center text-secondary py-8 text-sm">порожньо</p>}
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
};

// Event Detail Page (Mobile) - Full screen view of event details
const EventDetailPage = () => {
  const navigate = useNavigate();
  const { events, settings, refreshEvents, smmTasksDefinition, allTaskDefs } = useApp();
  const location = useLocation();
  const pathParts = location.pathname.split("/");
  const eventId = pathParts[pathParts.length - 2]; // /event/{id}/view
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { loadEvent(); }, [eventId]);

  const loadEvent = async () => {
    try {
      const r = await axios.get(`${API}/events/${eventId}`);
      setEvent(r.data);
    } catch {
      toast.error("помилка");
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTask = async (reminderId, completed) => {
    try {
      await api.completeTask({ event_id: eventId, reminder_id: reminderId, completed });
      refreshEvents();
      loadEvent();
    } catch { toast.error("помилка"); }
  };

  const handleToggleSMMTask = async (taskId, completed) => {
    try {
      await api.completeSMMTask({ event_id: eventId, task_id: taskId, completed });
      refreshEvents();
      loadEvent();
    } catch { toast.error("помилка"); }
  };

  const handleCancel = async () => {
    await cancelEventAndArchive(event, { refreshEvents, onDone: () => navigate(-1) });
  };

  const handleRestore = async () => {
    try {
      await axios.patch(`${API}/events/${eventId}`, { cancelled: false });
      toast.success("відновлено"); refreshEvents(); loadEvent();
    } catch { toast.error("помилка"); }
  };

  const handleDelete = async () => {
    await deleteEventPermanentlyFlow(event, { refreshEvents, onDeleted: () => navigate(-1), onCancelled: () => navigate(-1) });
  };

  const handleSyncAltegio = async () => {
    setSyncing(true);
    try { await api.syncEventFromAltegio(eventId); toast.success("синхронізовано"); loadEvent(); refreshEvents(); }
    catch { toast.error("помилка синхронізації"); }
    finally { setSyncing(false); }
  };

  const handleExportCalendar = async () => {
    setExporting(true);
    try { await api.exportEventToCalendar(eventId); toast.success("додано до календаря"); loadEvent(); }
    catch { toast.error("помилка експорту"); }
    finally { setExporting(false); }
  };

  // ESC to go back
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') navigate(-1); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [navigate]);

  if (loading) return <div className="animate-fade-in p-4"><p className="text-secondary text-center py-12">завантажую...</p></div>;
  if (!event) return null;

  const bookingColor = getBookingStatusColor(event);
  const colorClass = getBookingColorClass(bookingColor);

  // Build task lists for 3 columns from this event
  const smmMap = {};
  smmTasksDefinition.forEach(t => { smmMap[t.id] = t; });

  const mgmtDefs = allTaskDefs.management || [];
  const smmDefs = allTaskDefs.smm || [];
  const mktgDefs = allTaskDefs.marketing || [];

  const managementTasks = (settings?.reminder_types || []).map(rt => {
    const date = event.reminders?.[rt.id];
    if (!date) return null;
    return { id: rt.id, name: rt.name, date, icon: rt.icon, completed: !!event.completed_tasks?.[rt.id], type: 'management' };
  }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));

  const smmTasks = smmDefs.map(td => {
    const date = event.smm_tasks?.[td.id];
    if (!date) return null;
    return { id: td.id, name: td.name, date, icon: SMM_ICONS[td.id] || 'circle', completed: !!event.completed_smm_tasks?.[td.id], type: 'smm', is_announcement: td.is_announcement, is_teamwork: td.is_teamwork };
  }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));

  const marketingTasks = mktgDefs.map(td => {
    const date = event.marketing_tasks?.[td.id];
    if (!date) return null;
    return { id: td.id, name: td.name, date, icon: td.icon || 'circle', completed: !!event.completed_marketing_tasks?.[td.id], type: 'marketing' };
  }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));

  const TaskColumn = ({ title, tasks, colorCls, onToggle }) => (
    <div className="desktop-column">
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-wide">{title}</span>
        <span className="text-xs text-secondary">{tasks.filter(t => t.completed).length}/{tasks.length}</span>
      </div>
      <div className="column-content">
        {tasks.length > 0 ? tasks.map(task => {
          const IconComponent = getIconComponent(task.icon);
          return (
            <div key={task.id} className={`task-item cursor-pointer ${task.completed ? 'opacity-40' : ''}`} onClick={() => onToggle(task.id, !task.completed)} data-testid={`detail-task-${task.id}`}>
              <div className={`task-icon ${colorCls}`}><IconComponent /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{task.name}</p>
                <p className="text-xs text-secondary">{formatDateUkrainian(task.date)}</p>
              </div>
              <button className={`task-checkbox ${task.completed ? "checked" : ""}`} onClick={(e) => { e.stopPropagation(); onToggle(task.id, !task.completed); }}>
                <Check className="w-4 h-4" />
              </button>
            </div>
          );
        }) : <p className="text-secondary text-center py-6 text-sm">немає завдань</p>}
      </div>
    </div>
  );

  return (
    <div className="desktop-dashboard" data-testid="event-detail-page">
      <header className="desktop-header">
        <div className="desktop-header-left">
          <span className="text-xl font-semibold">{event.title}</span>
          {event.cancelled && <span className="text-red-500 text-xs font-medium ml-2">скасовано</span>}
        </div>
        <div className="desktop-header-right">
          <button className="desktop-header-btn" onClick={() => navigate(`/event/${eventId}`)} title="редагувати"><Edit className="w-4 h-4" /></button>
          {!event.cancelled ? (
            <button className="btn-dark h-10 px-4 text-sm" onClick={handleCancel} title="скасувати і залишити в архіві"><X className="w-4 h-4" /><span>скасувати</span></button>
          ) : (
            <button className="desktop-header-btn text-green-500" onClick={handleRestore} title="відновити"><RotateCcw className="w-4 h-4" /></button>
          )}
          <button className="desktop-header-btn text-[#FF8370]" onClick={() => setDeleteDialogOpen(true)} title="видалити назавжди"><Trash2 className="w-4 h-4" /></button>
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(-1)} style={{marginRight: '-24px', paddingRight: '24px'}} data-testid="event-detail-close-area">
            <div className="desktop-header-btn"><ChevronLeft className="w-5 h-5" /></div>
          </div>
        </div>
      </header>

      <div className="desktop-columns-4">
        {/* Column 1: Event info */}
        <div className="desktop-column">
          <div className="px-4 py-3">
            <span className="text-sm font-semibold tracking-wide">ПОДІЯ</span>
          </div>
          <div className="column-content space-y-4 p-4">
            <div>
              <p className="text-sm text-secondary">{formatDateUkrainian(event.date)}</p>
              {event.start_time && <p className="text-sm text-secondary mt-1">{event.start_time}{event.end_time ? ` — ${event.end_time}` : ''}</p>}
            </div>
            {event.description && <p className="text-sm">{event.description}</p>}
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-sm text-secondary">ціна</span><span className="font-semibold">{event.price} ₴</span></div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-secondary">місць</span>
                {(event.altegio_booked_count !== null && event.altegio_booked_count !== undefined) ? (
                  <span className={`font-bold text-lg ${colorClass}`}>{event.altegio_booked_count}/{event.spots || 10}</span>
                ) : (
                  <span className="font-semibold">{event.spots || 10}</span>
                )}
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t border-[#E8E5DC]">
              <p className="text-xs text-secondary">синхронізація</p>
              <div className="flex gap-2">
                <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs hover:bg-gray-50" onClick={handleExportCalendar} disabled={exporting}>
                  <ExternalLink className="w-3.5 h-3.5" />{exporting ? "..." : "Calendar"}
                </button>
                <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs hover:bg-gray-50" onClick={handleSyncAltegio} disabled={syncing}>
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />{syncing ? "..." : "Altegio"}
                </button>
              </div>
              {event.altegio_last_sync && <p className="text-[10px] text-secondary text-center">оновлено: {new Date(event.altegio_last_sync).toLocaleString('uk-UA')}</p>}
            </div>
          </div>
        </div>

        {/* Column 2: MANAGER */}
        <TaskColumn title="MANAGER" tasks={managementTasks} colorCls="" onToggle={handleToggleTask} />

        {/* Column 3: SMM */}
        <TaskColumn title="SMM" tasks={smmTasks} colorCls="emerald" onToggle={handleToggleSMMTask} />

        {/* Column 4: MARKETER */}
        <TaskColumn title="MARKETER" tasks={marketingTasks} colorCls="orange" onToggle={(id, completed) => {
          // Marketing tasks use smm completion endpoint with marketing prefix
          handleToggleSMMTask(id, completed);
        }} />
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="dialog-content"><AlertDialogHeader><AlertDialogTitle>видалити подію назавжди?</AlertDialogTitle><AlertDialogDescription>Якщо є куплені місця, видалення зупиниться і буде запропоновано лише скасувати подію з архівом.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>назад</AlertDialogCancel><AlertDialogAction onClick={handleDelete} variant="danger">видалити назавжди</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

// Event Form with AI Parsing
const EventForm = () => {
  const navigate = useNavigate();
  const { refreshEvents, settings, events: allEvents } = useApp();
  const location = useLocation();
  const isNew = location.pathname === "/event/new";
  const eventId = !isNew ? location.pathname.split("/").pop() : null;

  // AI parsing state
  const [aiInput, setAiInput] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [parsedEvents, setParsedEvents] = useState([{ title: "", date: formatDateLocal(new Date()), price: 0, spots: 10, description: "", start_time: "12:00", end_time: "14:30", event_type: "new", repeat_days: [0] }]);
  // Altegio service matching is now done server-side (see backend
  // _altegio_match_service_by_title) — frontend doesn't need to touch it.
  const [clarificationMessage, setClarificationMessage] = useState("");
  const [showParsedResults, setShowParsedResults] = useState(false);
  const [showAiInput, setShowAiInput] = useState(false);

  // Manual form state (for editing)
  const [formData, setFormData] = useState({ title: "", date: "", price: "", description: "", spots: "10", start_time: "", end_time: "", event_type: "new", repeat_days: [0] });
  const [loading, setLoading] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [pastEvents, setPastEvents] = useState([]);

  // Get recent prices from existing events (ordered by creation date, newest first)
  const recentPrices = useMemo(() => {
    if (!allEvents || allEvents.length === 0) return [];
    const sorted = [...allEvents].sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));
    const seen = new Set();
    return sorted.map(e => e.price).filter(p => p && p > 0 && !seen.has(p) && seen.add(p));
  }, [allEvents]);

  // Close all dropdowns for a given event index
  const closeAllDropdowns = (index, except) => {
    const fields = ['_showPriceDropdown', '_showSpotsDropdown', '_showStartDropdown', '_showEndDropdown', '_showCalendar', '_showTitleDropdown'];
    fields.forEach(f => { if (f !== except) updateParsedEvent(index, f, false); });
  };

  // Auto-calculate end_time when start_time changes
  const handleStartTimeChange = (time, updateFn) => {
    if (time) {
      const [hours, minutes] = time.split(":").map(Number);
      const endHours = (hours + 3) % 24;
      const end_time = `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      updateFn({ start_time: time, end_time });
    } else {
      updateFn({ start_time: time });
    }
  };

  // ESC to close
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && isNew) navigate("/"); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isNew, navigate]);

  // Price focus handler — clear default "0"
  const handlePriceFocus = (e) => { if (e.target.value === "0" || e.target.value === 0) e.target.value = ""; };

  useEffect(() => { if (eventId) loadEvent(); }, [eventId]);

  const loadEvent = async () => {
    try { const r = await axios.get(`${API}/events/${eventId}`); const e = r.data;
      setFormData({
        title: e.title,
        date: e.date.split("T")[0],
        price: e.price.toString(),
        description: e.description,
        spots: (e.spots || 10).toString(),
        start_time: e.start_time || "",
        end_time: e.end_time || ""
      });
      setSelectedDate(new Date(e.date));
    } catch { toast.error("помилка"); navigate("/"); }
  };

  // AI parsing function
  const handleAiParse = async () => {
    if (!aiInput.trim()) return;
    setAiParsing(true);
    setClarificationMessage("");
    try {
      const response = await api.parseEvents(aiInput);
      const data = response.data;

      if (data.clarification_needed) {
        setClarificationMessage(data.clarification_message);
      }

      setParsedEvents(data.events || []);
      setShowParsedResults(true);
    } catch (e) {
      toast.error("не вдалося розпізнати. спробуй ще раз");
      console.error(e);
    } finally {
      setAiParsing(false);
    }
  };

  // Confirm and create parsed event
  const handleConfirmEvent = async (event, index) => {
    try {
      const isRegular = event.event_type === "regular";
      const data = {
        title: event.title,
        date: event.date || formatDateLocal(new Date()),
        price: parseFloat(event.price) || 0,
        spots: parseInt(event.spots) || 10,
        description: event.description || "",
        start_time: event.start_time || "",
        end_time: event.end_time || "",
        event_type: event.event_type || "new",
        repeat_days: isRegular ? (event.repeat_days || []) : [],
      };
      const result = await api.createEvent(data);
      if (isRegular && result?.series_count > 1) {
        toast.success(`серія "${event.title}" — ${result.series_count} подій створено!`);
      } else {
        toast.success(`"${event.title}" створено!`);
      }

      // Remove from list
      setParsedEvents(prev => prev.filter((_, i) => i !== index));
      await refreshEvents();

      // If no more events, go back
      if (parsedEvents.length <= 1) {
        navigate("/");
      }
    } catch {
      toast.error("помилка створення");
    }
  };

  // Update parsed event field
  const updateParsedEvent = (index, field, value) => {
    setParsedEvents(prev => prev.map((ev, i) => {
      if (i !== index) return ev;
      // Auto-calculate end_time when start_time changes
      if (field === "start_time" && value) {
        const [hours, minutes] = value.split(":").map(Number);
        const endHours = (hours + 3) % 24;
        const end_time = `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        return { ...ev, start_time: value, end_time };
      }
      return { ...ev, [field]: value };
    }));
  };

  // Manual submit (for editing)
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const data = { ...formData, price: parseFloat(formData.price), spots: parseInt(formData.spots) || 10, event_type: formData.event_type || "new", repeat_days: formData.repeat_days || [] };
      if (isNew) { await api.createEvent(data); toast.success("створено! 🎉"); }
      else { await api.updateEvent(eventId, data); toast.success("збережено!"); }
      await refreshEvents(); navigate("/");
    } catch { toast.error("помилка"); } finally { setLoading(false); }
  };

  // For editing existing event - show manual form
  if (!isNew) {
    return (
      <div className="animate-fade-in">
        <header className="page-header flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full"><ChevronLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-bold">редагувати</h1>
        </header>

        <form onSubmit={handleSubmit} className="page-content pt-4 space-y-6">
          <div className="form-field"><Label>назва</Label><Input placeholder="як назвемо?" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required className="form-input" /></div>
          <div className="form-field"><Label>дата</Label><Button type="button" variant="outline" className="form-input justify-start" onClick={() => setShowCalendar(true)}>{formData.date ? `${new Date(formData.date).getDate()} ${UK_MONTHS_NOMINATIVE[new Date(formData.date).getMonth()]}` : "обери дату"}</Button></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-field">
              <Label>початок</Label>
              <Input
                type="time"
                value={formData.start_time}
                onChange={(e) => handleStartTimeChange(e.target.value, (updates) => setFormData({ ...formData, ...updates }))}
                className="form-input"
              />
            </div>
            <div className="form-field">
              <Label>кінець</Label>
              <Input
                type="time"
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                className="form-input"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-field"><Label>ціна (₴)</Label><Input type="number" placeholder="0" value={formData.price} onFocus={(e) => { if (e.target.value === "0") setFormData({ ...formData, price: "" }); }} onChange={(e) => setFormData({ ...formData, price: e.target.value })} required className="form-input" /></div>
            <div className="form-field"><Label>місць</Label><Input type="number" placeholder="10" value={formData.spots} onChange={(e) => setFormData({ ...formData, spots: e.target.value })} className="form-input" /></div>
          </div>
          <div className="form-field"><Label>опис</Label><Textarea placeholder="що буде цікавого?" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="form-input min-h-24 resize-none py-3" /></div>
          <button type="submit" className="btn-dark w-full" disabled={loading}>{loading ? "зберігаю..." : "зберегти"}</button>
          <div className="h-12" />
        </form>

        <Dialog open={showCalendar} onOpenChange={setShowCalendar}>
          <DialogContent className="dialog-content">
            <Calendar mode="single" locale={uk} weekStartsOn={1} selected={selectedDate} onSelect={(d) => { if (d) { setSelectedDate(d); setFormData({ ...formData, date: formatDateLocal(d) }); } setShowCalendar(false); }} className="w-full" />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // New event with AI parsing
  return (
    <div className="fixed inset-0 z-50 bg-[#F6F5F1]">
      <div className="desktop-dashboard">
        <header className="desktop-header" style={{position: 'relative'}}>
          <div className="desktop-header-left">
            <span className="text-xl font-semibold">нова подія</span>
          </div>
          <div className="desktop-header-right cursor-pointer" onClick={() => navigate("/")} data-testid="event-form-close" style={{marginRight: '-24px', paddingRight: '24px'}}>
            <div className="desktop-header-btn relative">
              <X className="w-5 h-5" />
              <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-xs text-secondary flex items-center gap-1 whitespace-nowrap pointer-events-none font-normal">або <kbd className="px-1.5 py-0.5 bg-[rgba(243,238,226,0.1)] rounded text-[10px] font-mono border border-[rgba(243,238,226,0.16)]">ESC</kbd> щоб закрити</span>
            </div>
            <div className="desktop-header-btn opacity-0 pointer-events-none"><FileText className="w-5 h-5" /></div>
            <div className="btn-dark opacity-0 pointer-events-none"><Plus className="w-4 h-4" /><span>подія</span></div>
            <div className="desktop-header-btn opacity-0 pointer-events-none"><Settings className="w-5 h-5" /></div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-8">
        {showParsedResults || !showAiInput ? (
          <div className="max-w-3xl mx-auto space-y-6">
            {clarificationMessage && (
              <div className="p-4 rounded-xl bg-yellow-100 text-yellow-800 mb-4">
                <p className="font-medium">{clarificationMessage}</p>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                {parsedEvents.length > 1 ? `розпізнано ${parsedEvents.length} подій` : "нова подія"}
              </h2>
              <button className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors" onClick={() => setShowAiInput(true)} data-testid="switch-to-ai">
                <Sparkles className="w-4 h-4" /> заповнити з ШІ
              </button>
            </div>

            {parsedEvents.map((event, index) => {
              const TIME_OPTIONS = [];
              for (let h = 8; h <= 23; h++) {
                TIME_OPTIONS.push(`${String(h).padStart(2,'0')}:00`);
                TIME_OPTIONS.push(`${String(h).padStart(2,'0')}:30`);
              }

              return (
              <div key={index} className="p-6 rounded-2xl bg-black/5 space-y-4" data-testid={`parsed-event-${index}`}>
                <div className="flex-1 space-y-4">
                  {/* Title + Type on same row */}
                  <div className="flex gap-3 items-start">
                    <div className="form-field flex-1">
                      <div className="relative">
                        <Input
                          value={event.title}
                          onChange={(e) => {
                            updateParsedEvent(index, "title", e.target.value);
                            updateParsedEvent(index, "_showTitleDropdown", true);
                          }}
                          onFocus={() => {
                            closeAllDropdowns(index, '_showTitleDropdown');
                            updateParsedEvent(index, "_showTitleDropdown", true);
                          }}
                          onBlur={() => setTimeout(() => updateParsedEvent(index, "_showTitleDropdown", false), 200)}
                          className="form-input text-lg font-semibold pr-10"
                          placeholder="назва події"
                          autoComplete="off"
                        />
                        {event.title && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              updateParsedEvent(index, "title", "");
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-black/10 transition-colors"
                            aria-label="очистити назву"
                            data-testid={`clear-title-${index}`}
                          >
                            <X className="w-4 h-4 text-secondary" />
                          </button>
                        )}
                        {event._showTitleDropdown && (() => {
                          const q = (event.title || '').toLowerCase().trim();
                          // De-dup by title, keep newest entry per title (carries price/spots/time/desc)
                          const seen = new Set();
                          const recentEvents = [...allEvents]
                            .sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date))
                            .filter(e => {
                              if (!e.title || seen.has(e.title)) return false;
                              seen.add(e.title);
                              return true;
                            })
                            .filter(e => !q || e.title.toLowerCase().includes(q));
                          if (recentEvents.length === 0) return null;
                          return (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#F1EEE7] border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                              {recentEvents.map((src, i) => (
                                <button key={i} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 transition-colors" onMouseDown={() => {
                                  // Auto-fill everything from the past event EXCEPT the date.
                                  // Altegio service mapping is resolved server-side from title.
                                  setParsedEvents(prev => prev.map((ev, idx) => {
                                    if (idx !== index) return ev;
                                    return {
                                      ...ev,
                                      title: src.title,
                                      price: src.price ?? ev.price,
                                      spots: src.spots ?? ev.spots,
                                      description: src.description ?? ev.description,
                                      start_time: src.start_time || ev.start_time,
                                      end_time: src.end_time || ev.end_time,
                                      _showTitleDropdown: false,
                                    };
                                  }));
                                }}>{src.title}</button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="form-field" style={{width: '170px', flexShrink: 0}}>
                      <select
                        value={event.event_type || "new"}
                        onMouseDown={() => closeAllDropdowns(index, null)}
                        onFocus={() => closeAllDropdowns(index, null)}
                        onChange={(e) => updateParsedEvent(index, "event_type", e.target.value)}
                        className="form-input w-full bg-[#E3DACC] font-medium cursor-pointer text-sm"
                        style={{paddingRight: '36px', backgroundPosition: 'right 14px center'}}
                        data-testid={`event-type-select-${index}`}
                      >
                        <option value="new">подія</option>
                        <option value="regular">регулярна</option>
                      </select>
                    </div>
                  </div>

                  {/* Regular → weekday selector horizontal (replaces date) */}
                  {event.event_type === "regular" && (
                    <div className="form-field">
                      <Label className="text-sm text-secondary">дні тижня</Label>
                      <div className="flex gap-1.5 mt-1">
                        {[{v:0,l:'пн'},{v:1,l:'вт'},{v:2,l:'ср'},{v:3,l:'чт'},{v:4,l:'пт'},{v:5,l:'сб'},{v:6,l:'нд'}].map(day => {
                          const selected = (event.repeat_days || [0]).includes(day.v);
                          return (
                            <button key={day.v}
                              type="button"
                              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${selected ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] hover:bg-black/5'}`}
                              data-testid={`weekday-${day.v}`}
                              onClick={() => {
                                const days = event.repeat_days || [0];
                                const newDays = selected ? days.filter(d => d !== day.v) : [...days, day.v];
                                updateParsedEvent(index, "repeat_days", newDays.length ? newDays : [day.v]);
                              }}>
                              {day.l}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Date + Price + Spots row. For regular series, date = старт серії. */}
                  <div className="grid gap-3 grid-cols-3">
                    <div className="form-field">
                      <Label className="text-sm text-secondary">
                        {event.event_type === "regular" ? "початок серії" : "дата"}
                      </Label>
                      <Popover open={event._showCalendar} onOpenChange={(open) => { closeAllDropdowns(index, '_showCalendar'); updateParsedEvent(index, "_showCalendar", open); }}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={`form-input w-full text-left cursor-pointer ${event._isRepeat && event.date < formatDateLocal(new Date()) ? 'text-red-500 border-red-300' : ''}`}
                            data-testid={`date-picker-${index}`}
                          >
                            {event.date ? `${new Date(event.date).getDate()} ${UK_MONTHS_NOMINATIVE[new Date(event.date).getMonth()]}` : 'обери дату'}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="start">
                          <Calendar
                            mode="single" locale={uk} weekStartsOn={1}
                            selected={event.date ? new Date(event.date) : undefined}
                            onSelect={(d) => {
                              if (d) updateParsedEvent(index, "date", formatDateLocal(d));
                              updateParsedEvent(index, "_showCalendar", false);
                            }}
                            className="calendar-minimal"
                            modifiersClassNames={{ today: "calendar-today-visible" }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                      <div className="form-field relative">
                        <Label className="text-sm text-secondary">ціна (₴)</Label>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={event.price || ""}
                            onFocus={(e) => {
                              if (e.target.value === "0") updateParsedEvent(index, "price", "");
                              closeAllDropdowns(index, '_showPriceDropdown');
                              updateParsedEvent(index, "_showPriceDropdown", true);
                            }}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              updateParsedEvent(index, "price", val);
                            }}
                            onBlur={() => setTimeout(() => updateParsedEvent(index, "_showPriceDropdown", false), 200)}
                            className="form-input w-full"
                            placeholder="0"
                            data-testid={`price-input-${index}`}
                          />
                          {event._showPriceDropdown && recentPrices.length > 0 && (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#F1EEE7] border rounded-xl shadow-lg max-h-36 overflow-y-auto">
                              {recentPrices.map(p => (
                                <button key={p} className="w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 transition-colors" onMouseDown={() => {
                                  updateParsedEvent(index, "price", String(p));
                                  updateParsedEvent(index, "_showPriceDropdown", false);
                                }}>{p} ₴</button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="form-field relative">
                        <Label className="text-sm text-secondary">місць</Label>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => { closeAllDropdowns(index, '_showSpotsDropdown'); updateParsedEvent(index, "_showSpotsDropdown", !event._showSpotsDropdown); }}
                            className="form-input w-full text-left cursor-pointer"
                            data-testid={`spots-picker-${index}`}
                          >
                            {event.spots || 10}
                          </button>
                          {event._showSpotsDropdown && (
                            <div
                              ref={(el) => {
                                if (!el) return;
                                // Scroll the LIST (not the page!) so the selected item
                                // sits in the middle of the visible window. scrollIntoView
                                // would also scroll the page, which is jarring here.
                                const sel = el.querySelector('[data-selected="true"]');
                                if (sel) {
                                  el.scrollTop = sel.offsetTop - el.clientHeight / 2 + sel.offsetHeight / 2;
                                }
                              }}
                              className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#F1EEE7] border rounded-xl shadow-lg max-h-48 overflow-y-auto"
                            >
                              {Array.from({length: 20}, (_, i) => i + 1).map(s => {
                                const selected = String(event.spots) === String(s);
                                return (
                                  <button
                                    key={s}
                                    data-selected={selected}
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 transition-colors ${selected ? 'bg-black/5 font-medium' : ''}`}
                                    onClick={() => {
                                      updateParsedEvent(index, "spots", String(s));
                                      updateParsedEvent(index, "_showSpotsDropdown", false);
                                    }}
                                  >{s}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                  </div>

                  {/* Calendar is now in Popover above */}

                  {/* Time inputs with dropdown */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="form-field relative">
                      <Label className="text-sm text-secondary">початок</Label>
                      <div className="relative">
                        <input
                          type="text"
                          value={event.start_time || "12:00"}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateParsedEvent(index, "start_time", val);
                            // hide dropdown while typing
                            if (event._showStartDropdown) updateParsedEvent(index, "_showStartDropdown", false);
                            if (/^\d{2}:\d{2}$/.test(val)) {
                              const [h, m] = val.split(":").map(Number);
                              const endH = (h + 3) % 24;
                              updateParsedEvent(index, "end_time", `${String(endH).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
                            }
                          }}
                          onFocus={() => { closeAllDropdowns(index, '_showStartDropdown'); updateParsedEvent(index, "_showStartDropdown", true); }}
                          onBlur={() => setTimeout(() => updateParsedEvent(index, "_showStartDropdown", false), 200)}
                          className="form-input w-full cursor-pointer"
                          placeholder="12:00"
                          data-testid={`start-time-${index}`}
                        />
                        {event._showStartDropdown && (
                          <div
                            ref={(el) => {
                              if (!el) return;
                              const sel = el.querySelector('[data-selected="true"]');
                              if (sel) el.scrollTop = sel.offsetTop - el.clientHeight / 2 + sel.offsetHeight / 2;
                            }}
                            className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#F1EEE7] border rounded-xl shadow-lg max-h-48 overflow-y-auto"
                          >
                            {TIME_OPTIONS.map(t => {
                              const selected = (event.start_time || "12:00") === t;
                              return (
                                <button
                                  key={t}
                                  data-selected={selected}
                                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 transition-colors tabular-nums ${selected ? 'bg-black/5 font-medium' : ''}`}
                                  onMouseDown={() => {
                                    updateParsedEvent(index, "start_time", t);
                                    const [h, m] = t.split(":").map(Number);
                                    const endH = (h + 3) % 24;
                                    updateParsedEvent(index, "end_time", `${String(endH).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
                                    updateParsedEvent(index, "_showStartDropdown", false);
                                  }}
                                >{t}</button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="form-field relative">
                      <Label className="text-sm text-secondary">кінець</Label>
                      <div className="relative">
                        <input
                          type="text"
                          value={event.end_time || "14:30"}
                          onChange={(e) => {
                            updateParsedEvent(index, "end_time", e.target.value);
                            if (event._showEndDropdown) updateParsedEvent(index, "_showEndDropdown", false);
                          }}
                          onFocus={() => { closeAllDropdowns(index, '_showEndDropdown'); updateParsedEvent(index, "_showEndDropdown", true); }}
                          onBlur={() => setTimeout(() => updateParsedEvent(index, "_showEndDropdown", false), 200)}
                          className="form-input w-full cursor-pointer"
                          placeholder="14:30"
                          data-testid={`end-time-${index}`}
                        />
                        {event._showEndDropdown && (() => {
                          // Filter end-time options: only times AFTER start_time
                          const start = event.start_time || "00:00";
                          const validOptions = TIME_OPTIONS.filter(t => t > start);
                          const list = validOptions.length ? validOptions : TIME_OPTIONS;
                          return (
                            <div
                              ref={(el) => {
                                if (!el) return;
                                const sel = el.querySelector('[data-selected="true"]');
                                if (sel) el.scrollTop = sel.offsetTop - el.clientHeight / 2 + sel.offsetHeight / 2;
                              }}
                              className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#F1EEE7] border rounded-xl shadow-lg max-h-48 overflow-y-auto"
                            >
                              {list.map(t => {
                                const selected = (event.end_time || "") === t;
                                return (
                                  <button
                                    key={t}
                                    data-selected={selected}
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 transition-colors tabular-nums ${selected ? 'bg-black/5 font-medium' : ''}`}
                                    onMouseDown={() => {
                                      updateParsedEvent(index, "end_time", t);
                                      updateParsedEvent(index, "_showEndDropdown", false);
                                    }}
                                  >{t}</button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="form-field">
                    <Label className="text-sm text-secondary">опис</Label>
                    <Input
                      value={event.description || ""}
                      onChange={(e) => updateParsedEvent(index, "description", e.target.value)}
                      className="form-input"
                      placeholder="опис (необов'язково)"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    className="btn-dark flex-1"
                    onClick={() => handleConfirmEvent(event, index)}
                    disabled={!event.title || !event.date}
                    data-testid={`confirm-event-${index}`}
                  >
                    <Check className="w-4 h-4 mr-2" />
                    створити подію
                  </button>
                </div>
              </div>
              );
            })}

            {parsedEvents.length === 0 && (
              <div className="text-center py-12">
                <p className="text-secondary mb-4">всі події створено!</p>
                <Button onClick={() => navigate("/")}>повернутися</Button>
              </div>
            )}

            <div className="h-24" />

          </div>
        ) : (
          /* AI input view */
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">заповнити з ШІ</h2>
              <button className="text-sm text-secondary hover:text-primary transition-colors underline" onClick={() => { setShowAiInput(false); if (parsedEvents.length === 0) { setParsedEvents([{ title: "", date: formatDateLocal(new Date()), price: 0, spots: 10, description: "", start_time: "12:00", end_time: "14:30", event_type: "new", repeat_days: [0] }]); } }}>← вручну</button>
            </div>
            <p className="text-secondary text-sm">напиши інформацію про подію своїми словами — AI розпізнає назву, дату, ціну та кількість місць</p>
            <Textarea
              placeholder="наприклад: Bodyart Light 15 лютого, 700 грн, 10 місць. або встав список кількох подій..."
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              className="form-input min-h-40 resize-none text-lg"
              autoFocus
            />
            <button
              className="btn-dark w-full text-lg h-14"
              onClick={handleAiParse}
              disabled={aiParsing || !aiInput.trim()}
            >
              {aiParsing ? (
                <span className="flex items-center gap-2"><span className="animate-spin">⏳</span> розпізнаю...</span>
              ) : (
                <span className="flex items-center gap-2"><Sparkles className="w-5 h-5" /> розпізнати</span>
              )}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

// Statistics Page - Mobile with monthly analytics cards
const StatsPage = () => {
  const { events } = useApp();
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStatistics().then(r => {
      // Add demo data for previous months with proper analytics
      const currentMonth = new Date();
      const prev1 = new Date(currentMonth); prev1.setMonth(prev1.getMonth() - 1);
      const prev2 = new Date(currentMonth); prev2.setMonth(prev2.getMonth() - 2);

      const demoData = [
        { month: `${prev2.getFullYear()}-${String(prev2.getMonth() + 1).padStart(2, '0')}`, events_count: 5, cancelled_count: 0, planned_revenue: 70000, actual_revenue: 70000, deadlines_percent: 100, cancelled_percent: 0, badges: ["perfect"] },
        { month: `${prev1.getFullYear()}-${String(prev1.getMonth() + 1).padStart(2, '0')}`, events_count: 7, cancelled_count: 1, planned_revenue: 98000, actual_revenue: 84000, deadlines_percent: 92, cancelled_percent: 14, badges: ["excellent"] },
        ...r.data.map(s => ({ ...s, deadlines_percent: 100 - s.missed_deadlines_percent, actual_revenue: s.planned_revenue }))
      ];
      setStats(demoData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <h1 className="logo">аналітика</h1>
      </header>

      <div className="page-content pt-4 space-y-4">
        {loading ? <p className="text-center py-12 text-secondary text-sm">завантажую...</p> : (
          <>
            {stats.map((month) => (
              <div key={month.month} className="analytics-card">
                <div className="analytics-card-header">
                  <span className="analytics-card-month">{formatMonthShort(month.month)}</span>
                  {month.badges?.includes("perfect") && <span className="badge badge-perfect"><Award className="w-4 h-4 mr-1" />100%</span>}
                  {month.badges?.includes("excellent") && <span className="badge badge-excellent"><Star className="w-4 h-4 mr-1" />90%+</span>}
                </div>
                <div className="analytics-card-grid">
                  <div className="analytics-metric">
                    <p className="analytics-metric-value">{month.events_count}</p>
                    <p className="analytics-metric-label">подій</p>
                  </div>
                  <div className="analytics-metric">
                    <p className="analytics-metric-value">{month.planned_revenue?.toLocaleString()} ₴</p>
                    <p className="analytics-metric-label">плановий дохід</p>
                  </div>
                  <div className="analytics-metric">
                    <p className="analytics-metric-value">{month.deadlines_percent || 100}%</p>
                    <p className="analytics-metric-label">дедлайни</p>
                  </div>
                  <div className="analytics-metric">
                    <p className="analytics-metric-value">{month.cancelled_percent || 0}%</p>
                    <p className="analytics-metric-label">скасовано</p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

// Altegio Sync Section Component
const AltegioSyncSection = () => {
  const { refreshEvents } = useApp();
  const [altegioStatus, setAltegioStatus] = useState({ connected: false });
  const [altegioEvents, setAltegioEvents] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [statusRes, eventsRes] = await Promise.all([
          api.getAltegioStatus(),
          api.getAltegioEvents()
        ]);
        setAltegioStatus(statusRes.data);
        setAltegioEvents(eventsRes.data.events || []);
      } catch (e) {
        console.error("Altegio fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncFromAltegio();
      toast.success(res.data.message || "Синхронізовано!");
      refreshEvents();
      // Refresh Altegio events
      const eventsRes = await api.getAltegioEvents();
      setAltegioEvents(eventsRes.data.events || []);
    } catch (e) {
      toast.error("Помилка синхронізації");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="section-card">
        <p className="text-xs text-secondary">завантажую Altegio...</p>
      </div>
    );
  }

  return (
    <div className="section-card mt-4">
      <p className="text-xs text-secondary mb-4">синхронізація з Altegio</p>
      <div className="reminder-item">
        <div className="flex items-center gap-3">
          <div className="task-icon" style={{ background: altegioStatus.connected ? '#059669' : '#9CA3AF' }}>
            <RefreshCw className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Altegio</p>
            <p className="text-xs text-secondary">
              {altegioStatus.connected ? `підключено • ${altegioEvents.length} подій` : "не підключено"}
            </p>
          </div>
        </div>
        {altegioStatus.connected && (
          <button
            className="btn-dark text-sm px-3 py-1"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "..." : "оновити"}
          </button>
        )}
      </div>

      {altegioStatus.connected && altegioEvents.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-secondary">події в Altegio:</p>
          {altegioEvents.slice(0, 5).map(event => (
            <div key={event.id} className="flex items-center justify-between py-2 border-b border-[#E8E5DC] last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{event.service?.title || event.title}</p>
                <p className="text-xs text-secondary">
                  {new Date(event.date).toLocaleDateString('uk-UA')} • {event.capacity} місць
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${event.records_count > 0 ? 'text-emerald-600' : 'text-secondary'}`}>
                  {event.records_count}/{event.capacity}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const TelegramSettingsSection = ({ compact = false }) => {
  const [currentUser, setCurrentUser] = useState(getActorUser());
  const [status, setStatus] = useState(null);
  const [linkData, setLinkData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const loadStatus = useCallback(async (userId = currentUser) => {
    if (!userId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getTelegramStatus(userId);
      setStatus(res.data);
    } catch {
      toast.error("не вдалося отримати статус Telegram");
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadStatus(currentUser);
  }, [currentUser, loadStatus]);

  useEffect(() => {
    if (!linkData?.expires_at) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(linkData.expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [linkData]);

  const handleUserChange = (userId) => {
    setCurrentUser(userId);
    setLinkData(null);
    try {
      if (userId) localStorage.setItem(ACTOR_USER_STORAGE_KEY, userId);
      else localStorage.removeItem(ACTOR_USER_STORAGE_KEY);
    } catch {}
  };

  const handleCreateCode = async () => {
    if (!currentUser) {
      toast.info("спершу обери себе");
      return;
    }
    try {
      const res = await api.createTelegramLinkCode(currentUser);
      setLinkData(res.data);
      toast.success("код створено");
    } catch {
      toast.error("не вдалося створити код");
    }
  };

  const handleToggleMute = async () => {
    if (!currentUser || !status) return;
    try {
      const res = status.muted ? await api.unmuteTelegram(currentUser) : await api.muteTelegram(currentUser);
      setStatus(res.data);
      toast.success(status.muted ? "сповіщення увімкнено" : "сповіщення вимкнено");
    } catch {
      toast.error("не вдалося змінити статус");
    }
  };

  const handleUnlink = async () => {
    if (!currentUser || !status?.linked) return;
    try {
      const res = await api.unlinkTelegram(currentUser);
      setStatus(res.data);
      setLinkData(null);
      toast.success("Telegram відвʼязано");
    } catch {
      toast.error("не вдалося відвʼязати Telegram");
    }
  };

  const botUsername = linkData?.bot_username || status?.bot_username;
  const botUrl = botUsername ? `https://t.me/${botUsername.replace("@", "")}` : "";
  const codeText = linkData?.code ? `/link ${linkData.code}` : "";
  const statusText = !currentUser
    ? "обери себе"
    : loading
      ? "перевіряю..."
      : status?.linked
        ? `привʼязано${status.telegram_username ? ` як @${status.telegram_username}` : ""}${status.muted ? " · mute" : ""}`
        : "не привʼязано";

  return (
    <div className={compact ? "space-y-2" : "section-card mt-4"}>
      {!compact && <p className="text-xs text-secondary mb-4">сповіщення в Telegram</p>}
      <div className="reminder-item !py-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="task-icon"><MessageCircle className="w-4 h-4" /></div>
          <div className="min-w-0">
            <p className="font-medium text-sm">Telegram</p>
            <p className="text-xs text-secondary truncate">{statusText}</p>
          </div>
        </div>
        <select
          value={currentUser}
          onChange={(e) => handleUserChange(e.target.value)}
          className="h-8 rounded-full bg-[#F1EEE7] border border-black/10 px-2 text-xs"
        >
          <option value="">хто я</option>
          {TEAM_USER_OPTIONS.map(user => <option key={user.id} value={user.id}>{user.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button className="btn-dark h-9 !px-2 text-[11px] whitespace-nowrap" onClick={handleCreateCode} disabled={!currentUser}>
          {status?.linked ? "новий код" : "код TG"}
        </button>
        <button className="btn-subtle h-9 !px-2 text-[11px] whitespace-nowrap" onClick={handleToggleMute} disabled={!currentUser || !status?.linked}>
          {status?.muted ? "увімкнути" : "mute"}
        </button>
        <button className="btn-subtle h-9 !px-2 text-[11px] whitespace-nowrap" onClick={handleUnlink} disabled={!currentUser || !status?.linked}>
          відвʼязати
        </button>
      </div>

      {linkData?.code && (
        <div className="rounded-xl bg-black/5 p-3 flex gap-3 items-center">
          {botUrl && (
            <img
              className="w-20 h-20 rounded-lg bg-[#F1EEE7] p-1"
              alt="Telegram QR"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(botUrl)}`}
            />
          )}
          <div className="min-w-0">
            <p className="text-xs text-secondary mb-1">надішли боту команду</p>
            <p className="font-mono text-sm font-semibold truncate">{codeText}</p>
            <p className="text-xs text-secondary mt-1">{secondsLeft > 0 ? `діє ще ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "код протерміновано"}</p>
            {botUrl && <a className="text-xs underline mt-1 inline-block" href={botUrl} target="_blank" rel="noreferrer">відкрити бота</a>}
          </div>
        </div>
      )}
    </div>
  );
};

// Settings Page with edit capability

// ==================== CALENDAR PAGE (/cal) ====================
const CalendarFullPage = () => {
  const { events } = useApp();
  const [currentMonth, setCurrentMonth] = useState(new Date());

  return (
    <div style={{ background: '#0A0A0A', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <Calendar mode="single" locale={uk} weekStartsOn={1} month={currentMonth} onMonthChange={setCurrentMonth} className="w-full calendar-dark"
          classNames={{ month: "space-y-1 w-full", caption: "flex justify-center items-center py-2", caption_label: "text-base font-medium text-[#F6F5F1]", row: "flex w-full", head_row: "flex w-full", head_cell: "text-gray-500 text-xs font-normal w-full text-center", table: "w-full border-collapse", cell: "text-center p-0", day: "w-full h-10 text-sm text-[#F6F5F1] hover:bg-[#F1EEE7]/10 rounded-lg transition-colors", nav_button: "w-8 h-8 bg-transparent hover:bg-[#F1EEE7]/10 rounded-full flex items-center justify-center text-[#F6F5F1]", day_selected: "bg-[#F1EEE7]/20" }}
          modifiersClassNames={{ today: "calendar-today-hidden" }}
          components={{ DayContent: ({ date }) => {
            const checkDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const hasEvent = events.some(e => !e.cancelled && e.date.startsWith(checkDate));
            return <div className="flex flex-col items-center"><span>{date.getDate()}</span>{hasEvent && <span className="w-1 h-1 rounded-full bg-[#F1EEE7] mt-0.5" />}</div>;
          }}}
        />
      </div>
    </div>
  );
};

// ==================== CONTENT PAGE ====================
const ContentPage = () => {
  const { events, smmTasksDefinition, refreshEvents } = useApp();
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingPost, setEditingPost] = useState(null);
  const [showPostDialog, setShowPostDialog] = useState(false);
  const [newPost, setNewPost] = useState({ title: '', date: formatDateLocal(new Date()), notes: '', post_type: 'info' });
  const [showNewPostDialog, setShowNewPostDialog] = useState(false);
  const [showNewPostCalendar, setShowNewPostCalendar] = useState(false);
  const [showEditPostCalendar, setShowEditPostCalendar] = useState(false);
  // Story creation
  const [newStory, setNewStory] = useState({ title: '', date: formatDateLocal(new Date()), notes: '' });
  const [showNewStoryDialog, setShowNewStoryDialog] = useState(false);
  const [showNewStoryCalendar, setShowNewStoryCalendar] = useState(false);
  // Task date editing
  const [editingTask, setEditingTask] = useState(null);
  const [showTaskEditDialog, setShowTaskEditDialog] = useState(false);
  const [showTaskEditCalendar, setShowTaskEditCalendar] = useState(false);
  // Month selector
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  // Completed accordion
  const [completedAnnouncementsOpen, setCompletedAnnouncementsOpen] = useState(false);
  const [completedStoriesOpen, setCompletedStoriesOpen] = useState(false);
  const [completedPostsOpen, setCompletedPostsOpen] = useState(false);
  // Calendar legend filters
  const [showCalAnnouncements, setShowCalAnnouncements] = useState(true);
  const [showCalStories, setShowCalStories] = useState(false);
  const [showCalInfoPosts, setShowCalInfoPosts] = useState(true);
  const [showCalMemes, setShowCalMemes] = useState(true);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayStr = formatDateLocal(today);

  // Story-related SMM task IDs
  const STORY_TASK_IDS = new Set([
    'smm_storytelling_prep', 'smm_storytelling', 'smm_master_story',
    'smm_storytelling_60', 'smm_remind_story', 'smm_post_stories', 'smm_past_events_50', 'smm_past_events_80'
  ]);

  // ESC to close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') navigate('/'); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [navigate]);

  useEffect(() => {
    axios.get(`${API}/posts`).then(r => setPosts(r.data)).catch(() => {});
  }, []);

  const refreshPosts = () => axios.get(`${API}/posts`).then(r => setPosts(r.data));

  // Announcement tasks from events (is_announcement flag) — grouped by event
  const announcements = useMemo(() => {
    const smmMap = {};
    smmTasksDefinition.forEach(t => { smmMap[t.id] = t; });
    const eventGroups = {};
    events.forEach(event => {
      if (event.cancelled || event.archived) return;
      const tasks = [];
      let earliestDate = null;
      Object.entries(event.smm_tasks || {}).forEach(([taskId, taskDate]) => {
        const taskInfo = smmMap[taskId];
        if (!taskInfo || !taskInfo.is_announcement) return;
        tasks.push({ task_id: taskId, task_name: taskInfo.name, date: taskDate, completed: !!(event.completed_smm_tasks || {})[taskId] });
        if (!earliestDate || taskDate < earliestDate) earliestDate = taskDate;
      });
      if (tasks.length > 0) {
        const allCompleted = tasks.every(t => t.completed);
        eventGroups[event.id] = { id: event.id, event_id: event.id, event_title: event.title, date: earliestDate, type: 'announcement', tasks, completed: allCompleted };
      }
    });
    return Object.values(eventGroups).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [events, smmTasksDefinition]);

  // Story tasks from events — individual tasks
  const stories = useMemo(() => {
    const items = [];
    const smmMap = {};
    smmTasksDefinition.forEach(t => { smmMap[t.id] = t; });
    events.forEach(event => {
      if (event.cancelled || event.archived) return;
      Object.entries(event.smm_tasks || {}).forEach(([taskId, taskDate]) => {
        const taskInfo = smmMap[taskId];
        if (!taskInfo || !STORY_TASK_IDS.has(taskId) || taskInfo.is_announcement) return;
        items.push({ id: `${event.id}-${taskId}`, event_id: event.id, task_id: taskId, task_name: taskInfo.name, event_title: event.title, date: taskDate, type: 'story', completed: !!(event.completed_smm_tasks || {})[taskId] });
      });
    });
    items.sort((a, b) => new Date(a.date) - new Date(b.date));
    return items;
  }, [events, smmTasksDefinition]);

  // Info-posts (user-created)
  const infoPosts = useMemo(() => [...posts].sort((a, b) => new Date(a.date) - new Date(b.date)), [posts]);

  // Calendar dots: only announcements & info-posts (NO stories)
  const announcementDates = useMemo(() => new Set(announcements.map(a => a.date)), [announcements]);
  const storyDates = useMemo(() => new Set(stories.map(s => s.date)), [stories]);
  const postDates = useMemo(() => {
    const map = { info: new Set(), meme: new Set() };
    posts.forEach(p => { const t = p.post_type || 'info'; if (map[t]) map[t].add(p.date); });
    return map;
  }, [posts]);

  const handleCreatePost = async () => {
    if (!newPost.title.trim()) return;
    try {
      await axios.post(`${API}/posts`, newPost);
      toast.success('створено!'); refreshPosts(); setShowNewPostDialog(false); setNewPost({ title: '', date: formatDateLocal(new Date()), notes: '', post_type: 'info' });
    } catch { toast.error('помилка'); }
  };

  const handleSavePost = async () => {
    if (!editingPost) return;
    try {
      await axios.patch(`${API}/posts/${editingPost.id}`, { title: editingPost.title, date: editingPost.date, notes: editingPost.notes, post_type: editingPost.post_type });
      toast.success('збережено!'); refreshPosts(); setShowPostDialog(false);
    } catch { toast.error('помилка'); }
  };

  const handleDeletePost = async () => {
    if (!editingPost) return;
    try {
      await axios.delete(`${API}/posts/${editingPost.id}`);
      toast.success('видалено!'); refreshPosts(); setShowPostDialog(false);
    } catch { toast.error('помилка'); }
  };

  const handleEventClick = (eventId) => navigate(`/event/${eventId}/view`);

  // Toggle completion for announcement/story (all SMM tasks for that event group)
  const handleToggleSmmCompletion = async (eventId, taskIds, currentlyCompleted) => {
    try {
      for (const taskId of (Array.isArray(taskIds) ? taskIds : [taskIds])) {
        await axios.post(`${API}/tasks/smm/complete`, { event_id: eventId, task_id: taskId, completed: !currentlyCompleted });
      }
      refreshEvents();
    } catch { toast.error('помилка'); }
  };

  // Toggle completion for user-created post
  const handleTogglePostCompletion = async (postId, currentlyCompleted) => {
    try {
      await axios.patch(`${API}/posts/${postId}`, { completed: !currentlyCompleted });
      refreshPosts();
    } catch { toast.error('помилка'); }
  };

  // Delete a post inline
  const handleDeletePostInline = async (postId, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/posts/${postId}`);
      toast.success('видалено!');
      refreshPosts();
    } catch { toast.error('помилка'); }
  };

  // Create a standalone story post
  const handleCreateStory = async () => {
    if (!newStory.title.trim()) return;
    try {
      await axios.post(`${API}/posts`, { ...newStory, post_type: 'story' });
      toast.success('створено!'); refreshPosts(); setShowNewStoryDialog(false); setNewStory({ title: '', date: formatDateLocal(new Date()), notes: '' });
    } catch { toast.error('помилка'); }
  };

  // Update task date (for announcement/story SMM tasks)
  const handleUpdateTaskDate = async () => {
    if (!editingTask) return;
    try {
      if (editingTask.type === 'post') {
        // It's a user-created post — update via posts endpoint
        await axios.patch(`${API}/posts/${editingTask.post_id}`, { date: editingTask.date });
      } else {
        // It's an event SMM task — update via smm_tasks override
        const event = events.find(e => e.id === editingTask.event_id);
        if (event) {
          const updatedSmmTasks = { ...event.smm_tasks, [editingTask.task_id]: editingTask.date };
          await axios.put(`${API}/events/${editingTask.event_id}`, { ...event, smm_tasks: updatedSmmTasks });
          refreshEvents();
        }
      }
      toast.success('дату оновлено!');
      refreshPosts();
      setShowTaskEditDialog(false);
    } catch { toast.error('помилка'); }
  };

  const PostTypeSelector = ({ value, onChange }) => (
    <div className="flex gap-2">
      <button onClick={() => onChange('info')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${value === 'info' ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400' : 'bg-[rgba(0,0,0,0.05)]'}`}>
        <Info className="w-3.5 h-3.5" style={{color: '#059669'}} />інфо
      </button>
      <button onClick={() => onChange('meme')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${value === 'meme' ? 'bg-pink-100 text-pink-700 ring-2 ring-pink-400' : 'bg-[rgba(0,0,0,0.05)]'}`}>
        <Smile className="w-3.5 h-3.5" style={{color: '#FF8370'}} />мем
      </button>
    </div>
  );

  // Filter by current month + split completed
  const monthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthAnnouncements = announcements.filter(a => a.date.startsWith(monthStr));
  const activeAnnouncements = monthAnnouncements.filter(a => !a.completed);
  const completedAnnouncements = monthAnnouncements.filter(a => a.completed);
  const monthStories = stories.filter(s => s.date.startsWith(monthStr));
  const activeStories = monthStories.filter(s => !s.completed);
  const completedStories = monthStories.filter(s => s.completed);
  const monthPosts = infoPosts.filter(p => p.date.startsWith(monthStr));
  const activePosts = monthPosts.filter(p => !p.completed);
  const completedPosts = monthPosts.filter(p => p.completed);

  const todayFormatted = useMemo(() => formatDateWithWeekday(new Date()), []);

  return (
    <div className="desktop-dashboard" data-testid="content-page">
      <header className="desktop-header">
        <div className="desktop-header-left gap-4">
          <span className="text-xl font-semibold">контент-план</span>
          <span className="text-sm text-secondary lowercase">{todayFormatted.weekday} • {todayFormatted.day} {todayFormatted.month}</span>
        </div>
        <div className="desktop-header-right cursor-pointer" onClick={() => navigate('/')} style={{marginRight: '-24px', paddingRight: '24px'}} data-testid="content-close-area">
          <div className="desktop-header-btn relative">
            <X className="w-5 h-5" />
            <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-xs text-secondary flex items-center gap-1 whitespace-nowrap pointer-events-none font-normal">або <kbd className="px-1.5 py-0.5 bg-[rgba(243,238,226,0.1)] rounded text-[10px] font-mono border border-[rgba(243,238,226,0.16)]">ESC</kbd> щоб закрити</span>
          </div>
          <div className="desktop-header-btn opacity-0 pointer-events-none"><FileText className="w-5 h-5" /></div>
          <div className="btn-dark opacity-0 pointer-events-none"><Plus className="w-4 h-4" /><span>подія</span></div>
          <div className="desktop-header-btn opacity-0 pointer-events-none"><Settings className="w-5 h-5" /></div>
        </div>
      </header>

      <div className="desktop-columns-4">
        {/* КАЛЕНДАР */}
        <div className="desktop-column">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-wide" style={{color:'#1A1717'}}>КАЛЕНДАР</span>
              <div className="flex items-center gap-1 relative">
                <button className="p-0.5 hover:bg-black/5 rounded-full transition-colors" onClick={() => { setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1)); setShowMonthPicker(false); }}><ChevronLeft className="w-3.5 h-3.5 text-secondary" /></button>
                <button className="text-xs font-medium text-secondary min-w-[60px] text-center hover:bg-black/5 rounded px-1 py-0.5" onClick={() => setShowMonthPicker(!showMonthPicker)}>{UK_MONTHS_NOMINATIVE[currentMonth.getMonth()]}</button>
                <button className="p-0.5 hover:bg-black/5 rounded-full transition-colors" onClick={() => { setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1)); setShowMonthPicker(false); }}><ChevronRight className="w-3.5 h-3.5 text-secondary" /></button>
                {showMonthPicker && (
                  <div className="absolute top-full left-0 mt-1 bg-[#F1EEE7] rounded-xl shadow-lg border p-3 z-50" style={{minWidth: '200px'}}>
                    <div className="flex items-center justify-between mb-2">
                      <button className="p-1 hover:bg-black/5 rounded-full" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear() - 1, currentMonth.getMonth()))}><ChevronLeft className="w-3.5 h-3.5" /></button>
                      <span className="text-xs font-semibold">{currentMonth.getFullYear()}</span>
                      <button className="p-1 hover:bg-black/5 rounded-full" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear() + 1, currentMonth.getMonth()))}><ChevronRight className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {UK_MONTHS_NOMINATIVE.map((m, i) => (
                        <button key={i} className={`text-xs py-1.5 px-1 rounded-lg transition-colors ${i === currentMonth.getMonth() ? 'bg-[#1A1717] text-[#F6F5F1]' : 'hover:bg-black/5'}`}
                          onClick={() => { setCurrentMonth(new Date(currentMonth.getFullYear(), i)); setShowMonthPicker(false); }}>{m.slice(0, 3)}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="column-content">
            <div className="calendar-container-desktop">
              <Calendar mode="single" locale={uk} weekStartsOn={1} month={currentMonth} onMonthChange={setCurrentMonth} className="w-full calendar-minimal calendar-wide !p-1"
                classNames={{ month: "space-y-0 w-full", caption: "hidden", row: "flex w-full", head_row: "flex w-full", table: "w-full border-collapse" }}
                modifiersClassNames={{ today: "calendar-today-visible" }}
                components={{ DayContent: ({ date }) => {
                  const checkDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                  const hasAnnouncement = showCalAnnouncements && announcementDates.has(checkDate);
                  const hasStory = showCalStories && storyDates.has(checkDate);
                  const hasInfo = showCalInfoPosts && postDates.info.has(checkDate);
                  const hasMeme = showCalMemes && postDates.meme.has(checkDate);
                  return (
                    <div className="calendar-day-content">
                      <span>{date.getDate()}</span>
                      <div style={{display:'flex', gap:'2px', justifyContent:'center', marginTop:'1px'}}>
                        {hasAnnouncement && <span style={{width:'5px', height:'5px', borderRadius:'50%', background:'#E8913A', display:'block'}} />}
                        {hasStory && <span style={{width:'5px', height:'5px', borderRadius:'50%', background:'#A78BFA', display:'block'}} />}
                        {hasInfo && <span style={{width:'5px', height:'5px', borderRadius:'50%', background:'#059669', display:'block'}} />}
                        {hasMeme && <span style={{width:'5px', height:'5px', borderRadius:'50%', background:'#FF8370', display:'block'}} />}
                      </div>
                    </div>
                  );
                }}}
              />
            </div>
            <div className="px-3 pt-2 space-y-2">
              <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
                <span onClick={() => setShowCalAnnouncements(!showCalAnnouncements)} className="flex items-center justify-center rounded-full shrink-0" style={{width:'16px', height:'16px', background: showCalAnnouncements ? '#E8913A' : 'transparent', border: '2px solid #E8913A'}}>{showCalAnnouncements && <Check className="w-2.5 h-2.5 text-[#F6F5F1]" />}</span>
                анонси
              </label>
              <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
                <span onClick={() => setShowCalStories(!showCalStories)} className="flex items-center justify-center rounded-full shrink-0" style={{width:'16px', height:'16px', background: showCalStories ? '#A78BFA' : 'transparent', border: '2px solid #A78BFA'}}>{showCalStories && <Check className="w-2.5 h-2.5 text-[#F6F5F1]" />}</span>
                історії
              </label>
              <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
                <span onClick={() => setShowCalInfoPosts(!showCalInfoPosts)} className="flex items-center justify-center rounded-full shrink-0" style={{width:'16px', height:'16px', background: showCalInfoPosts ? '#059669' : 'transparent', border: '2px solid #059669'}}>{showCalInfoPosts && <Check className="w-2.5 h-2.5 text-[#F6F5F1]" />}</span>
                інфо-пости
              </label>
              <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
                <span onClick={() => setShowCalMemes(!showCalMemes)} className="flex items-center justify-center rounded-full shrink-0" style={{width:'16px', height:'16px', background: showCalMemes ? '#FF8370' : 'transparent', border: '2px solid #FF8370'}}>{showCalMemes && <Check className="w-2.5 h-2.5 text-[#F6F5F1]" />}</span>
                меми
              </label>
            </div>
          </div>
        </div>

        {/* АНОНСИ */}
        <div className="desktop-column">
          <div className="px-4 py-3">
            <span className="text-sm font-semibold tracking-wide" style={{color:'#1A1717'}}>АНОНСИ</span>
          </div>
          <div className="column-content">
            {completedAnnouncements.length > 0 && (
              <div className="mb-3">
                <button className="section-header-mini w-full text-left" style={{color: '#9CA3AF'}} onClick={() => setCompletedAnnouncementsOpen(!completedAnnouncementsOpen)}>
                  <span>виконані ({completedAnnouncements.length})</span>
                  <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${completedAnnouncementsOpen ? "rotate-180" : ""}`} />
                </button>
                {completedAnnouncementsOpen && completedAnnouncements.map(item => (
                  <div key={item.id} className="event-card-desktop opacity-40" data-testid={`completed-announcement-${item.id}`}>
                    <div className="date-badge-desktop" style={{background: '#E8913A', color: 'white'}}>
                      <span className="date-badge-month" style={{color: 'rgba(255,255,255,0.8)'}}>{UK_MONTHS_SHORT[new Date(item.date).getMonth()]}</span>
                      <span className="date-badge-day">{new Date(item.date).getDate()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate line-through">{item.event_title}</p>
                    </div>
                    <button className="task-checkbox checked" onClick={(e) => { e.stopPropagation(); handleToggleSmmCompletion(item.event_id, item.tasks.map(t => t.task_id), true); }}>
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {activeAnnouncements.length > 0 ? (
              <div className="space-y-1">
                {Object.entries(activeAnnouncements.reduce((g, a) => { if (!g[a.date]) g[a.date] = []; g[a.date].push(a); return g; }, {})).map(([date, items]) => (
                  <div key={date} className="mb-2">
                    <p className="text-xs text-secondary font-medium mb-1 px-1">{formatDateUkrainian(date)}</p>
                    {items.map(item => (
                      <div key={item.id} className="event-card-desktop cursor-pointer" onClick={() => { setEditingTask({ ...item, type: 'announcement', task_name: item.event_title }); setShowTaskEditCalendar(false); setShowTaskEditDialog(true); }} data-testid={`announcement-${item.id}`}>
                        <div className="date-badge-desktop" style={{background: '#E8913A', color: 'white'}}>
                          <span className="date-badge-month" style={{color: 'rgba(255,255,255,0.8)'}}>{UK_MONTHS_SHORT[new Date(item.date).getMonth()]}</span>
                          <span className="date-badge-day">{new Date(item.date).getDate()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{item.event_title}</p>
                        </div>
                        <button className="task-checkbox" onClick={(e) => { e.stopPropagation(); handleToggleSmmCompletion(item.event_id, item.tasks.map(t => t.task_id), false); }} data-testid={`complete-announcement-${item.id}`}>
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : <p className="text-secondary text-center py-8 text-sm">немає анонсів</p>}
          </div>
        </div>

        {/* ІСТОРІЇ */}
        <div className="desktop-column">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold tracking-wide" style={{color:'#1A1717'}}>ІСТОРІЇ</span>
            <button className="add-btn" onClick={() => { setNewStory({ title: '', date: todayStr, notes: '' }); setShowNewStoryCalendar(false); setShowNewStoryDialog(true); }} data-testid="add-story-btn"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="column-content">
            {/* Completed stories accordion */}
            {(() => {
              const completedUserStories = posts.filter(p => p.post_type === 'story' && p.completed && p.date.startsWith(monthStr));
              const completedEventStories = monthStories.filter(s => s.completed);
              const allCompleted = [...completedEventStories, ...completedUserStories.map(p => ({ id: p.id, task_name: p.title, event_title: 'вручну', date: p.date, type: 'user-story', post_id: p.id, completed: true }))];
              if (allCompleted.length === 0) return null;
              return (
                <div className="mb-3">
                  <button className="section-header-mini w-full text-left" style={{color: '#9CA3AF'}} onClick={() => setCompletedStoriesOpen(!completedStoriesOpen)}>
                    <span>виконані ({allCompleted.length})</span>
                    <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${completedStoriesOpen ? "rotate-180" : ""}`} />
                  </button>
                  {completedStoriesOpen && allCompleted.map(item => (
                    <div key={item.id} className="task-item opacity-40" data-testid={`completed-story-${item.id}`}>
                      <div className="task-icon" style={{background: 'rgba(167,139,250,0.15)', color: '#A78BFA'}}><Camera className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate line-through">{item.task_name}</p>
                        <p className="text-xs text-secondary truncate">{item.event_title}</p>
                      </div>
                      <button className="task-checkbox checked" onClick={(e) => { e.stopPropagation(); item.type === 'user-story' ? handleTogglePostCompletion(item.post_id, true) : handleToggleSmmCompletion(item.event_id, item.task_id, true); }}>
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* Active user-created stories */}
            {posts.filter(p => p.post_type === 'story' && !p.completed && p.date.startsWith(monthStr)).map(post => (
              <div key={post.id} className="task-item cursor-pointer" onClick={() => { setEditingPost({...post}); setShowEditPostCalendar(false); setShowPostDialog(true); }} data-testid={`story-post-${post.id}`}>
                <div className="task-icon" style={{background: 'rgba(167,139,250,0.15)', color: '#A78BFA'}}><Camera className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{post.title}</p>
                  <p className="text-xs text-secondary">вручну</p>
                </div>
                <button className="task-checkbox" onClick={(e) => { e.stopPropagation(); handleTogglePostCompletion(post.id, false); }} data-testid={`complete-story-${post.id}`}>
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ))}
            {/* Active event-based stories */}
            {activeStories.length > 0 ? (
              <div className="space-y-1">
                {Object.entries(activeStories.reduce((g, s) => { if (!g[s.date]) g[s.date] = []; g[s.date].push(s); return g; }, {})).map(([date, items]) => (
                  <div key={date} className="mb-2">
                    <p className="text-xs text-secondary font-medium mb-1 px-1">{formatDateUkrainian(date)}</p>
                    {items.map(item => (
                      <div key={item.id} className="task-item cursor-pointer" onClick={() => { setEditingTask({ ...item, type: 'story' }); setShowTaskEditCalendar(false); setShowTaskEditDialog(true); }} data-testid={`story-${item.id}`}>
                        <div className="task-icon" style={{background: 'rgba(167,139,250,0.15)', color: '#A78BFA'}}><Camera className="w-4 h-4" /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.task_name}</p>
                          <p className="text-xs text-secondary truncate">{item.event_title}</p>
                        </div>
                        <button className="task-checkbox" onClick={(e) => { e.stopPropagation(); handleToggleSmmCompletion(item.event_id, item.task_id, false); }} data-testid={`complete-story-${item.id}`}>
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (posts.filter(p => p.post_type === 'story' && !p.completed && p.date.startsWith(monthStr)).length === 0 && <p className="text-secondary text-center py-8 text-sm">немає історій</p>)}
          </div>
        </div>

        {/* ІНФО-ПОСТИ */}
        <div className="desktop-column">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold tracking-wide" style={{color:'#1A1717'}}>ІНФО-ПОСТИ</span>
            <button className="add-btn" onClick={() => { setNewPost({ title: '', date: todayStr, notes: '', post_type: 'info' }); setShowNewPostCalendar(false); setShowNewPostDialog(true); }} data-testid="add-post-btn"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="column-content">
            {completedPosts.length > 0 && (
              <div className="mb-3">
                <button className="section-header-mini w-full text-left" style={{color: '#9CA3AF'}} onClick={() => setCompletedPostsOpen(!completedPostsOpen)}>
                  <span>виконані ({completedPosts.length})</span>
                  <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${completedPostsOpen ? "rotate-180" : ""}`} />
                </button>
                {completedPostsOpen && completedPosts.map(post => {
                  const isInfo = !post.post_type || post.post_type === 'info';
                  const badgeColor = isInfo ? '#059669' : '#FF8370';
                  return (
                    <div key={post.id} className="event-card-desktop opacity-40" data-testid={`completed-post-${post.id}`}>
                      <div className="date-badge-desktop" style={{background: badgeColor, color: 'white'}}>
                        <span className="date-badge-month" style={{color: 'rgba(255,255,255,0.8)'}}>{UK_MONTHS_SHORT[new Date(post.date).getMonth()]}</span>
                        <span className="date-badge-day">{new Date(post.date).getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate line-through">{post.title}</p>
                        <p className="text-xs text-secondary">{isInfo ? 'інфо' : 'мем'}</p>
                      </div>
                      <button className="task-checkbox checked" onClick={(e) => { e.stopPropagation(); handleTogglePostCompletion(post.id, true); }} data-testid={`undo-post-${post.id}`}>
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {activePosts.length > 0 ? activePosts.map(post => {
              const isInfo = !post.post_type || post.post_type === 'info';
              const badgeColor = isInfo ? '#059669' : '#FF8370';
              return (
                <div key={post.id} className="event-card-desktop" data-testid={`post-${post.id}`}>
                  <div className="date-badge-desktop" style={{background: badgeColor, color: 'white'}}>
                    <span className="date-badge-month" style={{color: 'rgba(255,255,255,0.8)'}}>{UK_MONTHS_SHORT[new Date(post.date).getMonth()]}</span>
                    <span className="date-badge-day">{new Date(post.date).getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                    setEditingTask({ id: post.id, post_id: post.id, task_name: post.title, date: post.date, event_title: isInfo ? 'інфо' : 'мем', type: 'post' });
                    setShowTaskEditCalendar(false);
                    setShowTaskEditDialog(true);
                  }}>
                    <p className="text-sm font-semibold truncate">{post.title}</p>
                    <p className="text-xs text-secondary">{isInfo ? 'інфо' : 'мем'}</p>
                  </div>
                  <button className="task-checkbox" onClick={(e) => { e.stopPropagation(); handleTogglePostCompletion(post.id, false); }} data-testid={`complete-post-${post.id}`}>
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              );
            }) : <p className="text-secondary text-center py-8 text-sm">немає постів</p>}
          </div>
        </div>
      </div>

      {/* New Post Dialog */}
      <Dialog open={showNewPostDialog} onOpenChange={setShowNewPostDialog}>
        <DialogContent className="dialog-content" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>новий пост</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <Input autoFocus placeholder="назва посту" value={newPost.title} onChange={(e) => setNewPost({...newPost, title: e.target.value})} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCreatePost(); }} className="form-input" />
            <div className="flex items-center gap-3">
              <button className="text-sm px-4 py-2 rounded-full bg-[rgba(0,0,0,0.05)]" onClick={() => setShowNewPostCalendar(!showNewPostCalendar)}>{formatDateUkrainian(newPost.date)}</button>
              <PostTypeSelector value={newPost.post_type} onChange={(t) => setNewPost({...newPost, post_type: t})} />
            </div>
            {showNewPostCalendar && <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(newPost.date)} onSelect={(d) => { if (d) { setNewPost({...newPost, date: formatDateLocal(d)}); } setShowNewPostCalendar(false); }} className="w-full" />}
            <textarea placeholder="нотатки..." value={newPost.notes} onChange={(e) => setNewPost({...newPost, notes: e.target.value})} className="form-input w-full min-h-[80px] resize-none text-sm p-3 rounded-xl border" />
            <button className="btn-dark w-full" onClick={handleCreatePost}>створити</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Post Dialog */}
      {editingPost && (
        <Dialog open={showPostDialog} onOpenChange={setShowPostDialog}>
          <DialogContent className="dialog-content" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader><DialogTitle>редагування</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <Input autoFocus value={editingPost.title} onChange={(e) => setEditingPost({...editingPost, title: e.target.value})} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSavePost(); }} className="form-input" />
              <div className="flex items-center gap-3">
                <button className="text-sm px-4 py-2 rounded-full bg-[rgba(0,0,0,0.05)]" onClick={() => setShowEditPostCalendar(!showEditPostCalendar)}>{formatDateUkrainian(editingPost.date)}</button>
                <PostTypeSelector value={editingPost.post_type || 'info'} onChange={(t) => setEditingPost({...editingPost, post_type: t})} />
              </div>
              {showEditPostCalendar && <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(editingPost.date)} onSelect={(d) => { if (d) { setEditingPost({...editingPost, date: formatDateLocal(d)}); } setShowEditPostCalendar(false); }} className="w-full" />}
              <textarea value={editingPost.notes || ''} onChange={(e) => setEditingPost({...editingPost, notes: e.target.value})} placeholder="нотатки..." className="form-input w-full min-h-[100px] resize-none text-sm p-3 rounded-xl border" />
              <div className="flex gap-2">
                <button className="flex-1 py-2.5 text-sm rounded-full border border-red-200 text-red-600" onClick={handleDeletePost}><Trash2 className="w-3.5 h-3.5 inline mr-1" />видалити</button>
                <button className="btn-dark flex-1" onClick={handleSavePost}>зберегти</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* New Story Dialog */}
      <Dialog open={showNewStoryDialog} onOpenChange={setShowNewStoryDialog}>
        <DialogContent className="dialog-content" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>нова історія</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <Input autoFocus placeholder="назва історії" value={newStory.title} onChange={(e) => setNewStory({...newStory, title: e.target.value})} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCreateStory(); }} className="form-input" />
            <button className="text-sm px-4 py-2 rounded-full bg-[rgba(0,0,0,0.05)]" onClick={() => setShowNewStoryCalendar(!showNewStoryCalendar)}>{formatDateUkrainian(newStory.date)}</button>
            {showNewStoryCalendar && <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(newStory.date)} onSelect={(d) => { if (d) setNewStory({...newStory, date: formatDateLocal(d)}); setShowNewStoryCalendar(false); }} className="w-full" />}
            <textarea placeholder="нотатки..." value={newStory.notes} onChange={(e) => setNewStory({...newStory, notes: e.target.value})} className="form-input w-full min-h-[80px] resize-none text-sm p-3 rounded-xl border" />
            <button className="btn-dark w-full" onClick={handleCreateStory}>створити</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Task Edit Dialog */}
      {editingTask && (
        <Dialog open={showTaskEditDialog} onOpenChange={setShowTaskEditDialog}>
          <DialogContent className="dialog-content" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader><DialogTitle>{editingTask.type === 'announcement' ? editingTask.event_title : editingTask.task_name}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              {editingTask.type === 'announcement' && (
                <>
                  <p className="text-xs text-secondary">{editingTask.event_title}</p>
                  <textarea placeholder="деталі анонсу..." value={editingTask.notes || ''} onChange={(e) => setEditingTask({...editingTask, notes: e.target.value})} className="form-input w-full min-h-[80px] resize-none text-sm p-3 rounded-xl border" />
                </>
              )}
              {editingTask.type === 'story' && (
                <p className="text-xs text-secondary">{editingTask.event_title}</p>
              )}
              {editingTask.type !== 'announcement' && editingTask.event_title && editingTask.type !== 'story' && (
                <div className="p-3 rounded-xl bg-black/5">
                  <p className="font-medium text-sm">{editingTask.task_name}</p>
                  <p className="text-xs text-secondary mt-0.5">{editingTask.event_title}</p>
                </div>
              )}
              <div>
                <button className="text-sm px-4 py-2 rounded-full bg-[rgba(0,0,0,0.05)] w-full text-left" onClick={() => setShowTaskEditCalendar(!showTaskEditCalendar)}>{formatDateUkrainian(editingTask.date)}</button>
                {showTaskEditCalendar && <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(editingTask.date)} onSelect={(d) => { if (d) setEditingTask({...editingTask, date: formatDateLocal(d)}); setShowTaskEditCalendar(false); }} className="w-full mt-2" />}
              </div>
              <div className="flex gap-2">
                {(editingTask.type === 'post' || editingTask.type === 'user-story') && (
                  <button className="flex-1 py-2.5 text-sm rounded-full border border-red-200 text-red-600" onClick={async () => { try { await axios.delete(`${API}/posts/${editingTask.post_id}`); toast.success('видалено!'); refreshPosts(); setShowTaskEditDialog(false); } catch { toast.error('помилка'); } }} data-testid="task-dialog-delete-btn"><Trash2 className="w-3.5 h-3.5 inline mr-1" />видалити</button>
                )}
                {editingTask.type === 'announcement' && (
                  <button className="flex-1 py-2.5 text-sm rounded-full border border-red-200 text-red-600" onClick={async () => { try { const event = events.find(e => e.id === editingTask.event_id); if (event) { const updatedSmmTasks = { ...event.smm_tasks }; (editingTask.tasks || []).forEach(t => delete updatedSmmTasks[t.task_id]); await axios.put(`${API}/events/${editingTask.event_id}`, { ...event, smm_tasks: updatedSmmTasks }); refreshEvents(); } toast.success('видалено!'); setShowTaskEditDialog(false); } catch { toast.error('помилка'); } }} data-testid="task-dialog-delete-btn"><Trash2 className="w-3.5 h-3.5 inline mr-1" />видалити</button>
                )}
                {editingTask.type === 'story' && (
                  <button className="flex-1 py-2.5 text-sm rounded-full border border-red-200 text-red-600" onClick={async () => { try { const event = events.find(e => e.id === editingTask.event_id); if (event) { const updatedSmmTasks = { ...event.smm_tasks }; delete updatedSmmTasks[editingTask.task_id]; await axios.put(`${API}/events/${editingTask.event_id}`, { ...event, smm_tasks: updatedSmmTasks }); refreshEvents(); } toast.success('видалено!'); setShowTaskEditDialog(false); } catch { toast.error('помилка'); } }} data-testid="task-dialog-delete-btn"><Trash2 className="w-3.5 h-3.5 inline mr-1" />видалити</button>
                )}
                <button className="btn-dark flex-1" onClick={handleUpdateTaskDate}>зберегти</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};


// Reusable editor block for a task definition.
// Two task types: "event" (tied to event date) and "regular" (monthly/daily).
const TaskDefEditor = ({ draft, setDraft }) => {
  const [showDetails, setShowDetails] = useState(false);
  if (!draft) return null;
  const COLS = [
    { v: "management", l: "Manager" },
    { v: "smm",        l: "SMM" },
    { v: "marketing",  l: "Marketer" },
  ];
  // Backwards-compat: treat missing frequency as "event" (legacy hardcoded tasks)
  const freq = draft.frequency || "event";
  const setFreq = (f) => {
    const upd = { ...draft, frequency: f };
    if (f === "daily") upd.days_before = 0;
    if (f !== "event") {
      // Strip event-specific fields for regular tasks
      upd.condition = null;
      upd.is_announcement = false;
      upd.series_master_only = false;
    }
    setDraft(upd);
  };
  const cond = draft.condition || null;
  const condType = cond ? cond.type : "none";
  const condThreshold = cond ? cond.threshold : 70;
  const setCondition = (type, threshold) => {
    if (type === "none") setDraft({ ...draft, condition: null });
    else setDraft({ ...draft, condition: { type, threshold: parseInt(threshold) || 70 } });
  };

  const FREQS = [
    { v: "event",   l: "на подію",  hint: "за N днів до кожної події" },
    { v: "monthly", l: "щомісяця", hint: "за N днів від початку місяця" },
    { v: "daily",   l: "щоденно",  hint: "автоматично кожен день" },
  ];

  return (
    <div className="mt-4 space-y-4">
      {/* Type selector */}
      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-full bg-black/5">
        {FREQS.map(f => (
          <button
            key={f.v}
            type="button"
            onClick={() => setFreq(f.v)}
            className={`h-9 rounded-full text-[12.5px] font-medium transition-all ${freq === f.v ? 'bg-[#F1EEE7] text-[#1A1717] shadow-sm' : 'text-[#1A1717]/55 hover:text-[#1A1717]'}`}
          >{f.l}</button>
        ))}
      </div>

      <Input
        value={draft.name || ""}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="назва"
        className="form-input"
      />

      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-[#1A1717]/50 mb-1.5">виконавець</div>
        <div className="grid grid-cols-3 gap-2">
          {COLS.map(c => (
            <button key={c.v} type="button"
              onClick={() => setDraft({ ...draft, column: c.v })}
              className={`h-10 rounded-full text-sm font-medium transition-colors ${draft.column === c.v ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] ring-1 ring-black/8 hover:bg-black/5'}`}
            >{c.l}</button>
          ))}
        </div>
      </div>

      {freq !== "daily" && (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-[#1A1717]/50 mb-1.5">
            {freq === "event" ? "за скільки днів до події" : "за скільки днів від початку місяця"}
          </div>
          <Input type="number" value={draft.days_before ?? 0}
            onChange={(e) => setDraft({ ...draft, days_before: parseInt(e.target.value) || 0 })}
            className="form-input" />
        </div>
      )}

      {/* Collapsible details */}
      <button type="button"
        onClick={() => setShowDetails(s => !s)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-black/[0.03] text-[12.5px] font-medium text-[#1A1717]/65 transition-colors"
      >
        <span>деталі (умови, прапорці)</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
      </button>

      {showDetails && (
        <div className="pl-3 space-y-3 border-l-2 border-black/10">
          {freq === "event" && (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-[#1A1717]/50 mb-1.5">умова показу</div>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {[
                  { v: "none", l: "завжди" },
                  { v: "booking_below", l: "бронювань <" },
                  { v: "booking_above", l: "бронювань >" },
                ].map(o => (
                  <button key={o.v} type="button"
                    onClick={() => setCondition(o.v, condThreshold)}
                    className={`h-9 rounded-full text-[12px] font-medium transition-colors ${condType === o.v ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] ring-1 ring-black/8 hover:bg-black/5'}`}
                  >{o.l}</button>
                ))}
              </div>
              {condType !== "none" && (
                <div className="flex items-center gap-2">
                  <Input type="number" value={condThreshold}
                    onChange={(e) => setCondition(condType, e.target.value)}
                    className="form-input" />
                  <span className="text-sm text-secondary">%</span>
                </div>
              )}
            </div>
          )}
          {freq === "event" && [
            { f: "is_announcement",    l: "анонс — зсув на постинговий день" },
            { f: "is_teamwork",        l: "тімворк — тільки студійні дні" },
            { f: "series_master_only", l: "лише на батьківській події серії" },
          ].map(({f,l}) => (
            <label key={f} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-black/[0.03] cursor-pointer">
              <input type="checkbox" checked={!!draft[f]}
                onChange={(e) => setDraft({ ...draft, [f]: e.target.checked })}
                className="w-4 h-4 accent-[#1A1717]" />
              <span className="text-[13px]">{l}</span>
            </label>
          ))}
          {freq !== "event" && (
            <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-black/[0.03] cursor-pointer">
              <input type="checkbox" checked={!!draft.is_teamwork}
                onChange={(e) => setDraft({ ...draft, is_teamwork: e.target.checked })}
                className="w-4 h-4 accent-[#1A1717]" />
              <span className="text-[13px]">тімворк — тільки студійні дні</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
};

const SettingsPage = () => {
  const { settings, refreshSettings, refreshSMMTasksDefinition, refreshEvents, smmTasksDefinition, allTaskDefs, googleCalendarStatus, refreshGoogleStatus } = useApp();
  const [reminderTypes, setReminderTypes] = useState([]);
  const [activeTab, setActiveTab] = useState("management");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [newReminder, setNewReminder] = useState({ name: "", days_before: 7, icon: "bell" });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reminderToDelete, setReminderToDelete] = useState(null);
  // SMM editing state
  const [editingSMM, setEditingSMM] = useState(null);
  const [showEditSMMDialog, setShowEditSMMDialog] = useState(false);
  // Google Calendar state
  const [exportingAll, setExportingAll] = useState(false);

  useEffect(() => { if (settings?.reminder_types) setReminderTypes([...settings.reminder_types].sort((a, b) => b.days_before - a.days_before)); }, [settings]);

  const groupedSMMTasks = useMemo(() => {
    const groups = {}; smmTasksDefinition.forEach(t => { if (!groups[t.days_before]) groups[t.days_before] = []; groups[t.days_before].push(t); });
    return Object.entries(groups).sort(([a], [b]) => parseInt(b) - parseInt(a));
  }, [smmTasksDefinition]);

  const handleAddReminder = async () => { if (!newReminder.name.trim()) return; try { await api.createTaskDef({ ...newReminder, column: "management", days_before: newReminder.days_before || 7 }); toast.success("додано!"); refreshSMMTasksDefinition(); refreshEvents(); setShowAddDialog(false); setNewReminder({ name: "", days_before: 7, icon: "bell" }); } catch { toast.error("помилка"); } };
  const handleSaveTaskDef = async () => {
    if (!editingReminder?.name?.trim()) return;
    const freq = editingReminder.frequency || "event";
    const payload = {
      name: editingReminder.name,
      days_before: parseInt(editingReminder.days_before) || 0,
      column: editingReminder.column,
      frequency: freq,
      is_teamwork: !!editingReminder.is_teamwork,
    };
    if (freq === "event") {
      payload.is_announcement = !!editingReminder.is_announcement;
      payload.series_master_only = !!editingReminder.series_master_only;
      payload.condition = editingReminder.condition || null;
    }
    try { await api.editTaskDef(editingReminder.id, payload); toast.success("збережено!"); refreshSMMTasksDefinition(); refreshEvents(); setShowEditDialog(false); }
    catch { toast.error("помилка"); }
  };
  const handleDeleteReminder = async () => {
    try { await api.deleteTaskDef(reminderToDelete.id); toast.success("видалено!"); refreshSMMTasksDefinition(); refreshEvents(); setDeleteDialogOpen(false); }
    catch { toast.error("помилка"); }
  };

  const iconOptions = TASK_ICONS;

  const handleGoogleConnect = async () => {
    try {
      const response = await axios.get(`${API}/oauth/calendar/login`);
      window.location.href = response.data.authorization_url;
    } catch {
      toast.error("помилка підключення");
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      await axios.post(`${API}/oauth/calendar/disconnect`);
      refreshGoogleStatus();
      toast.success("Google Calendar відключено");
    } catch {
      toast.error("помилка");
    }
  };

  const handleExportAllEvents = async () => {
    setExportingAll(true);
    try {
      const response = await axios.post(`${API}/calendar/export-all`);
      if (response.data.exported_count > 0) {
        toast.success(`Експортовано ${response.data.exported_count} подій`);
      } else {
        toast.info("Немає нових подій для експорту");
      }
    } catch (e) {
      toast.error("Помилка експорту");
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <h1 className="logo">налаштування</h1>
      </header>

      <div className="page-content pt-4 space-y-4">
        <div className="settings-tabs">
          <button className={`settings-tab ${activeTab === "management" ? "active" : ""}`} onClick={() => setActiveTab("management")}>менеджмент</button>
          <button className={`settings-tab ${activeTab === "smm" ? "active" : ""}`} onClick={() => setActiveTab("smm")}>smm</button>
          <button className={`settings-tab ${activeTab === "marketing" ? "active" : ""}`} onClick={() => setActiveTab("marketing")}>маркетинг</button>
          <button className={`settings-tab ${activeTab === "sync" ? "active" : ""}`} onClick={() => setActiveTab("sync")}>інше</button>
        </div>

        {activeTab === "sync" && (
          <div className="section-card">
            <p className="text-xs text-secondary mb-4">синхронізація з Google Calendar</p>
            <div className="reminder-item">
              <div className="flex items-center gap-3">
                <div className="task-icon"><CalendarIcon /></div>
                <div>
                  <p className="text-sm font-medium">Google Calendar</p>
                  <p className="text-xs text-secondary">{googleCalendarStatus.connected ? (googleCalendarStatus.email || "підключено ✓") : "не підключено"}</p>
                </div>
              </div>
              {!googleCalendarStatus.connected ? (
                <button className="btn-dark text-sm px-3 py-1" onClick={handleGoogleConnect}>підключити</button>
              ) : (
                <button className="text-red-500 text-sm" onClick={handleGoogleDisconnect}>відключити</button>
              )}
            </div>
            {googleCalendarStatus.connected && (
              <>
                <p className="text-xs text-green-600 mt-2">✓ Нові події автоматично синхронізуються</p>
                <button
                  className="btn-subtle w-full mt-4"
                  onClick={handleExportAllEvents}
                  disabled={exportingAll}
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>{exportingAll ? "експортую..." : "експортувати всі події"}</span>
                </button>
              </>
            )}
            {!googleCalendarStatus.connected && (
              <p className="text-xs text-secondary mt-4">після підключення події будуть автоматично додаватися до твого календаря</p>
            )}
          </div>
        )}

        {activeTab === "sync" && (
          <AltegioSyncSection />
        )}

        {activeTab === "sync" && (
          <TelegramSettingsSection />
        )}

        {activeTab === "management" && (
          <div className="section-card">
            <p className="text-xs text-secondary mb-4">завдання менеджменту для кожної події</p>
            {(allTaskDefs.management || []).sort((a, b) => b.days_before - a.days_before).map((task) => {
              const IconComponent = getIconComponent(task.icon || "circle");
              return (
                <div key={task.id} className="reminder-item" onClick={() => { setEditingReminder({ ...task, column: task.column || "management" }); setShowEditDialog(true); }}>
                  <div className="flex items-center gap-3">
                    <div className="task-icon"><IconComponent /></div>
                    <div><p className="text-sm font-medium">{task.name}</p><p className="text-xs text-secondary">за {task.days_before} днів</p></div>
                  </div>
                  <Edit className="w-4 h-4 text-secondary" />
                </div>
              );
            })}
            <button className="mt-3 w-full h-11 rounded-full bg-[#F1EEE7] ring-1 ring-black/8 hover:bg-black/5 transition-colors text-sm font-medium inline-flex items-center justify-center gap-1.5"
              onClick={() => { setNewReminder({ name: "", days_before: 7, column: "management", frequency: "event", is_announcement: false, is_teamwork: false, series_master_only: false, condition: null }); setShowAddDialog(true); }}>
              <Plus className="w-4 h-4" />новий таск
            </button>
          </div>
        )}

        {activeTab === "smm" && (
          <div className="section-card">
            <p className="text-xs text-secondary mb-4">автоматичні завдання для SMM команди</p>
            {(allTaskDefs.smm || []).sort((a, b) => b.days_before - a.days_before).map(task => {
              const IconComponent = getIconComponent(SMM_ICONS[task.id] || "instagram");
              return (
                <div key={task.id} className="reminder-item" onClick={() => { setEditingSMM({ ...task, column: task.column || "smm", icon: SMM_ICONS[task.id] || "instagram" }); setShowEditSMMDialog(true); }}>
                  <div className="flex items-center gap-3">
                    <div className="task-icon"><IconComponent /></div>
                    <div><p className="text-sm font-medium">{task.name}</p><p className="text-xs text-secondary">за {task.days_before} днів</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    {task.is_announcement && <span className="text-xs text-secondary">анонс</span>}
                    {task.is_teamwork && <span className="text-xs text-secondary">тімворк</span>}
                    <Edit className="w-4 h-4 text-secondary" />
                  </div>
                </div>
              );
            })}
            <button className="mt-3 w-full h-11 rounded-full bg-[#F1EEE7] ring-1 ring-black/8 hover:bg-black/5 transition-colors text-sm font-medium inline-flex items-center justify-center gap-1.5"
              onClick={() => { setNewReminder({ name: "", days_before: 7, column: "smm", frequency: "event", is_announcement: false, is_teamwork: false, series_master_only: false, condition: null }); setShowAddDialog(true); }}>
              <Plus className="w-4 h-4" />новий таск
            </button>
          </div>
        )}

        {activeTab === "marketing" && (
          <div className="section-card">
            <p className="text-xs text-secondary mb-4">завдання маркетингу для кожної події</p>
            {(allTaskDefs.marketing || []).sort((a, b) => b.days_before - a.days_before).map(task => {
              const IconComponent = getIconComponent(task.icon || "circle");
              return (
                <div key={task.id} className="reminder-item" onClick={() => { setEditingSMM({ ...task, column: task.column || "marketing", icon: task.icon || "circle" }); setShowEditSMMDialog(true); }}>
                  <div className="flex items-center gap-3">
                    <div className="task-icon"><IconComponent /></div>
                    <div><p className="text-sm font-medium">{task.name}</p><p className="text-xs text-secondary">за {task.days_before} днів</p></div>
                  </div>
                  <Edit className="w-4 h-4 text-secondary" />
                </div>
              );
            })}
            {(allTaskDefs.marketing || []).length === 0 && <p className="text-center text-secondary text-sm py-4">немає завдань</p>}
            <button className="mt-3 w-full h-11 rounded-full bg-[#F1EEE7] ring-1 ring-black/8 hover:bg-black/5 transition-colors text-sm font-medium inline-flex items-center justify-center gap-1.5"
              onClick={() => { setNewReminder({ name: "", days_before: 7, column: "marketing", frequency: "event", is_announcement: false, is_teamwork: false, series_master_only: false, condition: null }); setShowAddDialog(true); }}>
              <Plus className="w-4 h-4" />новий таск
            </button>
          </div>
        )}
      </div>

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>новий таск</DialogTitle>
            <DialogDescription>система буде створювати його автоматично для кожної події</DialogDescription>
          </DialogHeader>
          <TaskDefEditor
            draft={newReminder}
            setDraft={setNewReminder}
          />
          <DialogFooter className="mt-6">
            <button className="btn-dark w-full h-11" onClick={async () => {
              if (!newReminder.name?.trim()) return;
              try {
                const freq = newReminder.frequency || "event";
                const payload = {
                  name: newReminder.name,
                  days_before: parseInt(newReminder.days_before) || 0,
                  column: newReminder.column || activeTab,
                  frequency: freq,
                  is_teamwork: !!newReminder.is_teamwork,
                };
                if (freq === "event") {
                  payload.is_announcement = !!newReminder.is_announcement;
                  payload.series_master_only = !!newReminder.series_master_only;
                  payload.condition = newReminder.condition || null;
                }
                await api.createTaskDef(payload);
                toast.success("додано!");
                refreshSMMTasksDefinition();
                refreshEvents();
                setShowAddDialog(false);
                setNewReminder({ name: "", days_before: 7, column: activeTab, frequency: "event", is_announcement: false, is_teamwork: false, series_master_only: false, condition: null });
              } catch { toast.error("помилка"); }
            }}>створити</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog (management) — full editor with column / flags / delete */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>редагувати таск</DialogTitle>
            <DialogDescription>зміни записуються в історію — можна відкотити</DialogDescription>
          </DialogHeader>
          {editingReminder && (
            <TaskDefEditor
              draft={editingReminder}
              setDraft={setEditingReminder}
            />
          )}
          <DialogFooter className="mt-6 flex gap-2">
            <button className="flex-1 h-11 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5 text-sm font-medium" onClick={() => { setReminderToDelete(editingReminder); setShowEditDialog(false); setDeleteDialogOpen(true); }}>
              <Trash2 className="w-4 h-4" />видалити
            </button>
            <button className="btn-dark flex-1 h-11" onClick={handleSaveTaskDef}>зберегти</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="dialog-content"><AlertDialogHeader><AlertDialogTitle>видалити?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>скасувати</AlertDialogCancel><AlertDialogAction onClick={handleDeleteReminder} variant="danger">видалити</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SMM/Marketing Edit Dialog — full editor */}
      <Dialog open={showEditSMMDialog} onOpenChange={setShowEditSMMDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>редагувати таск</DialogTitle>
            <DialogDescription>зміни записуються в історію — можна відкотити</DialogDescription>
          </DialogHeader>
          {editingSMM && (
            <TaskDefEditor
              draft={editingSMM}
              setDraft={setEditingSMM}
            />
          )}
          <DialogFooter className="mt-6 flex gap-2">
            <button className="flex-1 h-11 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5 text-sm font-medium" onClick={async () => {
              if (!editingSMM) return;
              try { await api.deleteTaskDef(editingSMM.id); toast.success("видалено!"); refreshSMMTasksDefinition(); refreshEvents(); setShowEditSMMDialog(false); }
              catch { toast.error("помилка"); }
            }}>
              <Trash2 className="w-4 h-4" />видалити
            </button>
            <button className="btn-dark flex-1 h-11" onClick={async () => {
              if (!editingSMM) return;
              const freq = editingSMM.frequency || "event";
              const payload = {
                name: editingSMM.name,
                days_before: parseInt(editingSMM.days_before) || 0,
                column: editingSMM.column,
                frequency: freq,
                is_teamwork: !!editingSMM.is_teamwork,
              };
              if (freq === "event") {
                payload.is_announcement = !!editingSMM.is_announcement;
                payload.series_master_only = !!editingSMM.series_master_only;
                payload.condition = editingSMM.condition || null;
              }
              try { await api.editTaskDef(editingSMM.id, payload); toast.success("збережено!"); refreshSMMTasksDefinition(); refreshEvents(); setShowEditSMMDialog(false); }
              catch { toast.error("помилка"); }
            }}>зберегти</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
};

// Archive Content Component - 4 columns with week/month accordions
const ArchiveContent = ({ archive, completedSMMTasksDesktop, archivedEvents, standaloneTasks, handleRestoreTask, handleRestoreEvent, refreshEvents }) => {
  const [expandedWeeks, setExpandedWeeks] = useState({});

  // Helper to get week key from date
  const getWeekKey = (dateStr) => {
    const date = new Date(dateStr);
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay() + 1); // Monday
    return startOfWeek.toISOString().split('T')[0];
  };

  // Helper to get current week key
  const currentWeekKey = getWeekKey(new Date().toISOString());

  // Group items by week
  const groupByWeek = (items, dateField) => {
    const groups = {};
    items.forEach(item => {
      const dateStr = item[dateField] || item.completed_at || item.date;
      if (!dateStr) return;
      const weekKey = getWeekKey(dateStr);
      if (!groups[weekKey]) groups[weekKey] = [];
      groups[weekKey].push(item);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  };

  // Format week range
  const formatWeekRange = (weekKey) => {
    const start = new Date(weekKey);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startDay = start.getDate();
    const endDay = end.getDate();
    const month = UK_MONTHS_SHORT[start.getMonth()];
    const endMonth = UK_MONTHS_SHORT[end.getMonth()];
    if (start.getMonth() === end.getMonth()) {
      return `${startDay}—${endDay} ${month}`;
    }
    return `${startDay} ${month} — ${endDay} ${endMonth}`;
  };

  const toggleWeek = (columnKey, weekKey) => {
    const key = `${columnKey}-${weekKey}`;
    setExpandedWeeks(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isExpanded = (columnKey, weekKey) => {
    const key = `${columnKey}-${weekKey}`;
    return expandedWeeks[key] ?? (weekKey === currentWeekKey);
  };

  // Filter by team role
  const smmTasks = completedSMMTasksDesktop.filter(t => normalizeAssignee(t.assignee || t.color, "") === 'smm');
  const managerTasks = [...archive.filter(item => !item.is_standalone || standaloneTasks.find(t => t.id === item.event_id)?.type !== "smm"),
    ...completedSMMTasksDesktop.filter(t => normalizeAssignee(t.assignee || t.color, "manager") === 'manager' || t.color === 'standard')];
  const marketerTasks = completedSMMTasksDesktop.filter(t => normalizeAssignee(t.assignee || t.color, "") === 'marketer' || t.color === 'orange');

  const smmByWeek = groupByWeek(smmTasks, 'completed_at');
  const managerByWeek = groupByWeek(managerTasks, 'completed_at');
  const marketerByWeek = groupByWeek(marketerTasks, 'completed_at');
  const eventsByWeek = groupByWeek(archivedEvents, 'date');

  const renderArchiveColumn = (title, colorHex, weekGroups, columnKey, renderItem) => (
    <div className="desktop-column">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-wide" style={colorHex ? {color: colorHex} : {}}>{title}</span>
      </div>
      <div className="column-content">
        {weekGroups.length === 0 ? (
          <p className="text-secondary text-sm py-4 text-center">порожньо</p>
        ) : (
          weekGroups.map(([weekKey, items]) => (
            <div key={weekKey} className="mb-3">
              <button
                className="flex items-center justify-between w-full text-left py-2 text-sm font-medium text-secondary hover:text-primary"
                onClick={() => toggleWeek(columnKey, weekKey)}
              >
                <span>{formatWeekRange(weekKey)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{items.length}</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded(columnKey, weekKey) ? "rotate-180" : ""}`} />
                </div>
              </button>
              {isExpanded(columnKey, weekKey) && (
                <div className="space-y-1 pt-2">
                  {items.map((item, idx) => renderItem(item, idx))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="desktop-columns-4">
      {/* ПОДІЇ */}
      {renderArchiveColumn("ПОДІЇ", null, eventsByWeek, "events", (event, idx) => (
        <div key={event.id || idx} className="event-card-desktop">
          <div className="date-badge-desktop">
            <span className="date-badge-month">{UK_MONTHS_SHORT[new Date(event.date).getMonth()]}</span>
            <span className="date-badge-day">{new Date(event.date).getDate()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{event.title}</p>
            <p className="text-xs text-secondary">{event.price} ₴</p>
          </div>
          {event.cancelled ? (
            <button className="restore-btn cancelled" onClick={() => handleRestoreEvent(event.id)} title="відновити">
              <RotateCcw className="w-4 h-4" />
            </button>
          ) : (
            <span className="text-xs text-secondary">минула</span>
          )}
        </div>
      ))}

      {/* MANAGER */}
      {renderArchiveColumn("MANAGER", null, managerByWeek, "manager", (item, idx) => {
        const IconComponent = getIconComponent(item.icon || "check");
        return (
          <div key={idx} className="task-item">
            <div className="task-icon"><IconComponent /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{item.task_name || item.reminder_name}</p>
              <p className="text-xs text-secondary">{item.event_title}</p>
            </div>
            <button className="restore-btn" onClick={() => handleRestoreTask(item)} title="відновити">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        );
      })}

      {/* SMM */}
      {renderArchiveColumn("SMM", null, smmByWeek, "smm", (item, idx) => {
        const IconComponent = getIconComponent(item.icon || "instagram");
        return (
          <div key={idx} className="task-item">
            <div className="task-icon emerald"><IconComponent /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{item.task_name || item.reminder_name}</p>
              <p className="text-xs text-secondary">{item.event_title}</p>
            </div>
            <button className="restore-btn" onClick={async () => {
              try {
                await api.completeSMMTask({ event_id: item.event_id, task_id: item.task_id, completed: false });
                refreshEvents();
                toast.success("відновлено");
              } catch { toast.error("помилка"); }
            }} title="відновити">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        );
      })}

      {/* Marketer */}
      {renderArchiveColumn("MARKETER", "#C4703D", marketerByWeek, "marketer", (item, idx) => {
        const IconComponent = getIconComponent(item.icon || "instagram");
        return (
          <div key={idx} className="task-item">
            <div className="task-icon orange"><IconComponent /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{item.task_name || item.reminder_name}</p>
              <p className="text-xs text-secondary">{item.event_title}</p>
            </div>
            <button className="restore-btn" onClick={async () => {
              try {
                await api.completeSMMTask({ event_id: item.event_id, task_id: item.task_id, completed: false });
                refreshEvents();
                toast.success("відновлено");
              } catch { toast.error("помилка"); }
            }} title="відновити">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

// Desktop Dashboard
const getTaskDragKey = (task) => `${task.event_id}::${task.task_id || task.reminder_id}`;
const getTaskDate = (task) => task.task_date || task.reminder_date || task.date || "";
const getTaskOrder = (task) => Number(task.order || 0);

// Wraps a task render in a draggable handle.
const DraggableTask = ({ task, children, onDragStart, onDragMove, onDragEnd, onDropAtPointer }) => {
  const dragStateRef = useRef(null);
  const suppressClickRef = useRef(false);

  const cleanupPointerDrag = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const buildDropData = (clientX, clientY) => {
    const dropEl = document.elementFromPoint(clientX, clientY)?.closest("[data-task-drop-type]");
    if (!dropEl) return null;
    const type = dropEl.dataset.taskDropType;
    if (type === "task") return { type, taskKey: dropEl.dataset.taskKey };
    if (type === "date") return { type, assignee: dropEl.dataset.assignee, date: dropEl.dataset.date };
    if (type === "column") return { type, assignee: dropEl.dataset.assignee };
    return null;
  };

  const handlePointerMove = (e) => {
    const state = dragStateRef.current;
    if (!state) return;
    const distance = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
    if (!state.dragging && distance >= 6) {
      state.dragging = true;
      suppressClickRef.current = true;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      onDragStart(task, { x: e.clientX, y: e.clientY });
    }
    if (state.dragging) onDragMove({ x: e.clientX, y: e.clientY, over: buildDropData(e.clientX, e.clientY) });
  };

  const handlePointerUp = (e) => {
    const state = dragStateRef.current;
    cleanupPointerDrag();
    dragStateRef.current = null;
    if (state?.dragging) {
      const dropData = buildDropData(e.clientX, e.clientY);
      if (dropData) onDropAtPointer(dropData, task);
      onDragEnd();
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  };

  return (
    <div
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.target.closest("button,a,input,textarea,select,[role='button']")) return;
        dragStateRef.current = { startX: e.clientX, startY: e.clientY, dragging: false };
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
      }}
      onClickCapture={(e) => {
        if (!suppressClickRef.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        opacity: 1,
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      {children}
    </div>
  );
};

const DroppableTaskTarget = ({ task, children, isOver }) => {
  return (
    <div
      data-task-drop-type="task"
      data-task-key={getTaskDragKey(task)}
      className={isOver ? "rounded-xl ring-2 ring-[#1A1717]/30" : ""}
    >
      {children}
    </div>
  );
};

const DroppableDateSection = ({ assignee, date, children, isOver }) => {
  return (
    <div
      data-task-drop-type="date"
      data-assignee={assignee}
      data-date={date}
      className={isOver ? "rounded-xl bg-[#1A1717]/[0.05]" : ""}
    >
      {children}
    </div>
  );
};

// Team Column Component - reusable for SMM, Manager, Marketer
const TeamColumn = ({ name, tasks, colorClass, colorHex, onToggle, onEventClick, onStandaloneClick, onTaskEdit, onAddClick, overdueExpanded, setOverdueExpanded, soonExpanded, setSoonExpanded, smmTasksDefinition, columnAssignee, announcementOverlaps = {}, onOverlapClick, todayStr, onTaskDragStart, onTaskDragMove, onTaskDragEnd, onTaskDrop, dragOver }) => {
  const TaskRenderer = ({ task }) => {
    const colAssignee = columnAssignee || (colorClass === 'emerald' ? 'smm' : colorClass === 'orange' ? 'marketer' : 'manager');
    const taskDate = task.task_date || task.reminder_date;
    const isOverlapping = !!(taskDate && announcementOverlaps[taskDate]);
    const normalizedTask = {
      ...task,
      task_id: task.task_id || task.reminder_id,
      task_name: task.task_name || task.reminder_name,
      task_date: task.task_date || task.reminder_date,
      color: task.color || (colorClass === 'emerald' ? 'smm' : colorClass === 'orange' ? 'marketer' : 'manager'),
      assignee: normalizeAssignee(task.assignee, colAssignee),
      order: getTaskOrder(task),
      isOverlapping
    };
    return (
      <DroppableTaskTarget task={normalizedTask} isOver={dragOver?.type === "task" && dragOver.taskKey === getTaskDragKey(normalizedTask)}>
        <DraggableTask task={normalizedTask} onDragStart={onTaskDragStart} onDragMove={onTaskDragMove} onDragEnd={onTaskDragEnd} onDropAtPointer={onTaskDrop}>
          <SMMTaskItem
            key={`${normalizedTask.event_id}-${normalizedTask.task_id}`}
            task={normalizedTask}
            onToggle={onToggle}
            onEventClick={onEventClick}
            onStandaloneClick={onStandaloneClick}
            onTaskEdit={onTaskEdit}
            onOverlapClick={onOverlapClick}
            smmTasksDefinition={smmTasksDefinition}
          />
        </DraggableTask>
      </DroppableTaskTarget>
    );
  };

  return (
    <div
      className={`desktop-column transition-all duration-150 ${dragOver?.type === "column" && dragOver.assignee === columnAssignee ? "ring-2 ring-[#1A1717]/20" : ""}`}
      data-task-drop-type="column"
      data-assignee={columnAssignee}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-wide" style={{color:'#1A1717'}}>{name}</span>
        <button className="add-btn" onClick={onAddClick}><Plus className="w-4 h-4" /></button>
      </div>
      <div className="column-content">
        {tasks.overdue.length > 0 && (
          <div className="mb-3">
            <button className="section-header-mini overdue-header" onClick={() => setOverdueExpanded(!overdueExpanded)}>
              <span>протерміновано ({tasks.overdue.length})</span>
              <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${overdueExpanded ? "rotate-180" : ""}`} />
            </button>
            {overdueExpanded && tasks.overdue.map((t, i) => <TaskRenderer key={i} task={t} />)}
          </div>
        )}

        <div className="mb-3">
          <div className="section-header-mini"><span>сьогодні ({tasks.today.length})</span></div>
          <DroppableDateSection assignee={columnAssignee} date={todayStr} isOver={dragOver?.type === "date" && dragOver.assignee === columnAssignee && dragOver.date === todayStr}>
            {tasks.today.length > 0 ? [...tasks.today].sort((a, b) => getTaskOrder(a) - getTaskOrder(b) || (a.completed ? 1 : 0) - (b.completed ? 1 : 0)).map((t) => (
              <TaskRenderer key={getTaskDragKey({ ...t, task_id: t.task_id || t.reminder_id })} task={t} />
            )) : <p className="text-center text-secondary text-sm py-2">все зроблено!</p>}
          </DroppableDateSection>
        </div>

        {tasks.soon.length > 0 && (
          <div>
            <button className="section-header-mini" onClick={() => setSoonExpanded(!soonExpanded)}>
              <span>незабаром ({tasks.soon.length})</span>
              <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${soonExpanded ? "rotate-180" : ""}`} />
            </button>
            {soonExpanded && (
              <div className="pt-2">
                {Object.entries(tasks.soon.reduce((groups, task) => {
                  const dateKey = task.task_date || task.reminder_date;
                  if (!groups[dateKey]) groups[dateKey] = [];
                  groups[dateKey].push(task);
                  return groups;
                }, {})).map(([date, dateTasks]) => (
                  <div key={date} className="mb-2">
                    <p className={`text-xs font-medium mb-1 ${announcementOverlaps[date] ? "text-red-500" : "text-secondary"}`}>
                      {formatDateUkrainian(date)}
                      {announcementOverlaps[date] && <span className="ml-1.5 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">перетин</span>}
                    </p>
                    <DroppableDateSection assignee={columnAssignee} date={date} isOver={dragOver?.type === "date" && dragOver.assignee === columnAssignee && dragOver.date === date}>
                      {dateTasks.map((t) => (
                        <TaskRenderer key={getTaskDragKey({ ...t, task_id: t.task_id || t.reminder_id })} task={t} />
                      ))}
                    </DroppableDateSection>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DesktopDashboard = () => {
  const { events, settings, standaloneTasks, smmTasksDefinition, allTaskDefs, refreshEvents, refreshStandaloneTasks } = useApp();
  const { pushUndo } = useUndo();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archive, setArchive] = useState([]);
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [soonExpanded, setSoonExpanded] = useState(false);
  const [smmOverdueExpanded, setSmmOverdueExpanded] = useState(false);
  const [smmSoonExpanded, setSmmSoonExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventDetail, setShowEventDetail] = useState(false);
  const [cancelSeriesDialogFor, setCancelSeriesDialogFor] = useState(null); // event when series-cancel choice is needed
  // Series instances list — populated when an event detail opens that's part of a regular series
  const [seriesData, setSeriesData] = useState(null);
  const [seriesPickerOpen, setSeriesPickerOpen] = useState(false);
  // Day-off creation flow
  const [showDayOffDialog, setShowDayOffDialog] = useState(false);
  const [dayOffForm, setDayOffForm] = useState({ assignee: "manager", date: formatDateLocal(new Date()) });
  const [dayOffPlan, setDayOffPlan] = useState(null); // {day_off, auto_shifts, needs_review}
  const [reviewChoices, setReviewChoices] = useState({}); // task_id -> chosen new_date or null=skip
  const [dayOffSubmitting, setDayOffSubmitting] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [showSMMTaskDialog, setShowSMMTaskDialog] = useState(false);
  const [dialogColumnName, setDialogColumnName] = useState("");
  const [showTaskCalendar, setShowTaskCalendar] = useState(false);
  const [showSMMCalendar, setShowSMMCalendar] = useState(false);
  const [newTask, setNewTask] = useState(() => ({ title: "", date: formatDateLocal(new Date()), icon: "coffee", color: "manager" }));
  const [newSMMTask, setNewSMMTask] = useState(() => ({ title: "", date: formatDateLocal(new Date()), icon: "instagram", color: "manager" }));
  const [selectedStandaloneTask, setSelectedStandaloneTask] = useState(null);
  const [showStandaloneTaskPopup, setShowStandaloneTaskPopup] = useState(false);
  const [editingStandaloneTask, setEditingStandaloneTask] = useState(null);
  const [showEditStandaloneDialog, setShowEditStandaloneDialog] = useState(false);
  const [showEditCalendar, setShowEditCalendar] = useState(false);
  const [reschedulingTaskDate, setReschedulingTaskDate] = useState(null);
  const [activeTab, setActiveTab] = useState('team'); // 'team' or 'events'
  const [announcementOverlaps, setAnnouncementOverlaps] = useState({});
  const [overlapResolverTask, setOverlapResolverTask] = useState(null);

  // Fetch announcement overlaps
  useEffect(() => {
    axios.get(`${API}/smm/announcement-overlaps`).then(r => setAnnouncementOverlaps(r.data || {})).catch(() => {});
  }, [events]);

  // Expand states for each team column
  const [smmOverdue, setSMMOverdue] = useState(false);
  const [smmSoon, setSMMSoon] = useState(true);
  const [managerOverdue, setManagerOverdue] = useState(false);
  const [managerSoon, setManagerSoon] = useState(true);
  const [marketerOverdue, setVoOverdue] = useState(false);
  const [marketerSoon, setVoSoon] = useState(true);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayFormatted = formatDateWithWeekday(today);
  const todayStr = formatDateLocal(today);
  const twoWeeksFromNow = new Date(today); twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
  const twoWeeksStr = formatDateLocal(twoWeeksFromNow);

  // Archived events: cancelled OR past
  const archivedEvents = useMemo(() => {
    return events.filter(e => {
      const eventDate = new Date(e.date);
      eventDate.setHours(0, 0, 0, 0);
      return e.cancelled || eventDate < today;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [events, today]);

  // Completed SMM tasks from events
  const completedSMMTasksDesktop = useMemo(() => {
    const completed = [];
    events.forEach(event => {
      Object.entries(event.completed_smm_tasks || {}).forEach(([taskId, isCompleted]) => {
        if (isCompleted && smmTasksDefinition.find(t => t.id === taskId)) {
          const taskInfo = smmTasksDefinition.find(t => t.id === taskId);
          completed.push({
            event_id: event.id,
            event_title: event.title,
            task_id: taskId,
            task_name: taskInfo.name,
            icon: SMM_ICONS[taskId] || "instagram"
          });
        }
      });
    });
    return completed;
  }, [events, smmTasksDefinition]);

  // Tasks
  const getTasks = useCallback(() => {
    if (!settings?.reminder_types) return { overdue: [], today: [], soon: [] };
    const overdueTasks = [], todayTasks = [], soonTasks = [];
    const reminderMap = {}; settings.reminder_types.forEach(rt => { reminderMap[rt.id] = rt; });

    events.forEach(event => {
      if (event.cancelled) return;
      const eventDate = new Date(event.date); eventDate.setHours(0, 0, 0, 0);
      if (eventDate < today) return;

      Object.entries(event.reminders || {}).forEach(([reminderId, reminderDateStr]) => {
        const reminderInfo = reminderMap[reminderId]; if (!reminderInfo) return;
        const reminderDate = new Date(reminderDateStr); reminderDate.setHours(0, 0, 0, 0);
        const ov = (event.task_overrides || {})[reminderId] || {};
        const task = { event_id: event.id, event_title: event.title, reminder_id: reminderId, reminder_name: ov.title || reminderInfo.name, reminder_date: reminderDateStr, icon: ov.icon || reminderInfo.icon, completed: !!(event.completed_tasks || {})[reminderId], is_standalone: false, color: ov.color, assignee: normalizeAssignee(ov.assignee, ""), order: ov.order || 0 };

        if (reminderDateStr === todayStr) todayTasks.push(task);
        else if (reminderDate < today && !task.completed) overdueTasks.push(task);
        else if (reminderDate > today && reminderDateStr <= twoWeeksStr) soonTasks.push(task);
      });
    });

    standaloneTasks.filter(t => t.type !== "smm").forEach(task => {
      const taskDate = new Date(task.date); taskDate.setHours(0, 0, 0, 0);
      const linkedEvent = task.event_id ? events.find(event => event.id === task.event_id) : null;
      const t = { event_id: task.id, event_title: linkedEvent?.title || "", reminder_id: "standalone", reminder_name: task.title, reminder_date: task.date, icon: task.icon || "coffee", completed: task.completed, is_standalone: true, color: task.color || "manager", assignee: normalizeAssignee(task.assignee), type: task.type, event_id_link: task.event_id || "", order: task.order || 0 };
      if (task.date === todayStr) todayTasks.push(t);
      else if (taskDate < today && !task.completed) overdueTasks.push(t);
      else if (taskDate > today && task.date <= twoWeeksStr) soonTasks.push(t);
    });

    soonTasks.sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
    overdueTasks.sort((a, b) => new Date(a.reminder_date) - new Date(b.reminder_date));
    return { overdue: overdueTasks, today: todayTasks, soon: soonTasks };
  }, [events, settings, standaloneTasks, today, todayStr, twoWeeksStr]);

  // SMM Tasks
  const smmTasksMap = useMemo(() => { const map = {}; smmTasksDefinition.forEach(t => { map[t.id] = t; }); return map; }, [smmTasksDefinition]);

  const getSMMTasks = useCallback(() => {
    const overdueTasks = [], todayTasks = [], soonTasks = [];
    const processTasksDict = (event, tasksDict, completedDict) => {
      Object.entries(tasksDict || {}).forEach(([taskId, taskDateStr]) => {
        const taskInfo = smmTasksMap[taskId]; if (!taskInfo) return;
        const taskDate = new Date(taskDateStr); taskDate.setHours(0, 0, 0, 0);
        const ov2 = (event.task_overrides || {})[taskId] || {};
        const task = { event_id: event.id, event_title: event.title, task_id: taskId, task_name: ov2.title || taskInfo.name, task_date: taskDateStr, completed: !!(completedDict || {})[taskId], color: ov2.color || taskInfo.color || "standard", icon: ov2.icon || taskInfo.icon, assignee: normalizeAssignee(ov2.assignee, ""), order: ov2.order || 0 };
        if (taskDateStr === todayStr) todayTasks.push(task);
        else if (taskDate < today && !task.completed) overdueTasks.push(task);
        else if (taskDate > today && taskDateStr <= twoWeeksStr) soonTasks.push(task);
      });
    };
    events.forEach(event => {
      if (event.cancelled) return;
      const eventDate = new Date(event.date); eventDate.setHours(0, 0, 0, 0);
      if (eventDate < today) return;
      processTasksDict(event, event.smm_tasks, event.completed_smm_tasks);
      processTasksDict(event, event.marketing_tasks, event.completed_smm_tasks);
    });

    // Add standalone tasks
    standaloneTasks.filter(t => t.type === "smm").forEach(task => {
      const taskDate = new Date(task.date); taskDate.setHours(0, 0, 0, 0);
      const linkedEvent = task.event_id ? events.find(event => event.id === task.event_id) : null;
      const t = { event_id: task.id, event_title: linkedEvent?.title || "", task_id: "standalone", task_name: task.title, task_date: task.date, icon: task.icon || "instagram", completed: task.completed, is_standalone: true, color: task.color || "manager", assignee: normalizeAssignee(task.assignee, "smm"), type: task.type, event_id_link: task.event_id || "", order: task.order || 0 };
      if (task.date === todayStr) todayTasks.push(t);
      else if (taskDate < today && !task.completed) overdueTasks.push(t);
      else if (taskDate > today && task.date <= twoWeeksStr) soonTasks.push(t);
    });

    soonTasks.sort((a, b) => new Date(a.task_date) - new Date(b.task_date));
    overdueTasks.sort((a, b) => new Date(a.task_date) - new Date(b.task_date));
    return { overdue: overdueTasks, today: todayTasks, soon: soonTasks };
  }, [events, smmTasksMap, standaloneTasks, today, todayStr, twoWeeksStr]);

  const regularTasks = getTasks();
  const allSmmTasks = getSMMTasks();

  // Split tasks by team member
  const tasksByTeam = useMemo(() => {
    // Task column assignment by ID prefix or explicit assignee
    const getColumn = (t) => {
      const assignee = normalizeAssignee(t.assignee, "");
      if (assignee) return assignee === 'smm' ? 'smm' : assignee === 'marketer' ? 'marketing' : 'management';
      const id = t.task_id || '';
      if (id.startsWith('mgmt_')) return 'management';
      if (id.startsWith('smm_')) return 'smm';
      if (id.startsWith('mktg_')) return 'marketing';
      // Fallback to old color-based logic
      if (normalizeAssignee(t.color, "") === 'smm') return 'smm';
      return 'management';
    };
    const isSMM = (t) => getColumn(t) === 'smm';
    const isManager = (t) => getColumn(t) === 'management';
    const isMarketer = (t) => getColumn(t) === 'marketing';

    // Regular tasks: split by assignee
    const smmRegular = { overdue: [], today: [], soon: [] };
    const managerRegular = { overdue: [], today: [], soon: [] };
    const marketerRegular = { overdue: [], today: [], soon: [] };
    ['overdue', 'today', 'soon'].forEach(k => {
      regularTasks[k].forEach(t => {
        const assignee = normalizeAssignee(t.assignee);
        if (assignee === 'smm') smmRegular[k].push(t);
        else if (assignee === 'marketer') marketerRegular[k].push(t);
        else managerRegular[k].push(t);
      });
    });

    // Sort tasks: daily first, then event-based, then monthly
    const sortByType = (tasks) => {
      return tasks.sort((a, b) => {
        const da = getTaskDate(a);
        const db = getTaskDate(b);
        if (da !== db) return new Date(da) - new Date(db);
        const orderDiff = getTaskOrder(a) - getTaskOrder(b);
        if (orderDiff !== 0) return orderDiff;
        const typeOrder = (t) => {
          const id = t.task_id || t.reminder_id || t.event_id || '';
          if (id.startsWith('daily_') || (t.is_standalone && t.type !== 'monthly')) return 0; // daily/standalone
          if (typeof id === 'string' && id.startsWith('monthly-')) return 2; // monthly
          return 1; // event-based
        };
        const oa = typeOrder(a), ob = typeOrder(b);
        if (oa !== ob) return oa - ob;
        return (a.task_name || a.reminder_name || "").localeCompare(b.task_name || b.reminder_name || "");
      });
    };

    return {
      smm: {
        overdue: sortByType([...allSmmTasks.overdue.filter(t => isSMM(t)), ...smmRegular.overdue]),
        today: sortByType([...allSmmTasks.today.filter(t => isSMM(t)), ...smmRegular.today]),
        soon: sortByType([...allSmmTasks.soon.filter(t => isSMM(t)), ...smmRegular.soon]),
      },
      manager: {
        overdue: sortByType([...allSmmTasks.overdue.filter(t => isManager(t)), ...managerRegular.overdue]),
        today: sortByType([...allSmmTasks.today.filter(t => isManager(t)), ...managerRegular.today]),
        soon: sortByType([...allSmmTasks.soon.filter(t => isManager(t)), ...managerRegular.soon]),
      },
      marketer: {
        overdue: sortByType([...allSmmTasks.overdue.filter(t => isMarketer(t)), ...marketerRegular.overdue]),
        today: sortByType([...allSmmTasks.today.filter(t => isMarketer(t)), ...marketerRegular.today]),
        soon: sortByType([...allSmmTasks.soon.filter(t => isMarketer(t)), ...marketerRegular.soon]),
      }
    };
  }, [allSmmTasks, regularTasks]);

  const allEvents = getVisibleEventsForMonth(events, currentMonth, today);

  const handleToggleTask = async (eventId, reminderId, completed, isStandalone) => {
    try {
      if (isStandalone) {
        await api.updateStandaloneTask(eventId, completed);
        pushUndo({ label: "таск", run: async () => { await api.updateStandaloneTask(eventId, !completed); refreshStandaloneTasks(); } });
        refreshStandaloneTasks();
      } else {
        await api.completeTask({ event_id: eventId, reminder_id: reminderId, completed });
        pushUndo({ label: "таск", run: async () => { await api.completeTask({ event_id: eventId, reminder_id: reminderId, completed: !completed }); refreshEvents(); } });
        refreshEvents();
      }
    } catch { toast.error("помилка"); }
  };

  const handleToggleSMMTask = async (eventId, taskId, completed, isStandalone) => {
    try {
      if (isStandalone) {
        await api.updateStandaloneTask(eventId, completed);
        pushUndo({ label: "таск", run: async () => { await api.updateStandaloneTask(eventId, !completed); refreshStandaloneTasks(); } });
        refreshStandaloneTasks();
      } else {
        await api.completeSMMTask({ event_id: eventId, task_id: taskId, completed });
        pushUndo({ label: "таск", run: async () => { await api.completeSMMTask({ event_id: eventId, task_id: taskId, completed: !completed }); refreshEvents(); } });
        refreshEvents();
      }
    } catch { toast.error("помилка"); }
  };
  const loadArchive = async () => { try { const r = await api.getTaskArchive(); setArchive(r.data); setShowArchive(true); } catch { toast.error("помилка"); } };
  const handleRestoreTask = async (item) => {
    try {
      if (item.is_standalone) { await api.updateStandaloneTask(item.event_id, false); refreshStandaloneTasks(); }
      else { await api.completeTask({ event_id: item.event_id, reminder_id: item.reminder_id, completed: false }); refreshEvents(); }
      const r = await api.getTaskArchive(); setArchive(r.data);
    } catch { toast.error("помилка"); }
  };

  const handleDateClick = (date) => {
    if (date) {
      const dateStr = formatDateLocal(date);
      const element = document.querySelector(`[data-event-date="${dateStr}"]`);
      if (element) {
        const scrollContainer = element.closest('.column-content');
        if (scrollContainer) {
          const offset = element.offsetTop - scrollContainer.offsetTop - 10;
          scrollContainer.scrollTo({ top: offset, behavior: 'smooth' });
        }
        element.classList.add('event-highlight');
        setTimeout(() => element.classList.remove('event-highlight'), 2000);
      }
    }
  };

  const handleEventClick = async (eventId) => {
    try {
      const r = await axios.get(`${API}/events/${eventId}`);
      setSelectedEvent(r.data);
      setShowEventDetail(true);
      // Fetch series instances if this event belongs to a regular series
      const isSeries = !!r.data?.source_event_id || r.data?.event_type === "regular";
      if (isSeries) {
        try {
          const s = await axios.get(`${API}/events/${eventId}/series`);
          setSeriesData(s.data);
        } catch {
          setSeriesData(null);
        }
      } else {
        setSeriesData(null);
      }
    } catch { toast.error("помилка"); }
  };
  const handleToggleTaskInPopup = async (reminderId, completed) => { try { await api.completeTask({ event_id: selectedEvent.id, reminder_id: reminderId, completed }); refreshEvents(); const r = await axios.get(`${API}/events/${selectedEvent.id}`); setSelectedEvent(r.data); } catch { toast.error("помилка"); } };
  const handleToggleSMMTaskInPopup = async (taskId, completed) => { try { await api.completeSMMTask({ event_id: selectedEvent.id, task_id: taskId, completed }); refreshEvents(); const r = await axios.get(`${API}/events/${selectedEvent.id}`); setSelectedEvent(r.data); } catch { toast.error("помилка"); } };

  const [syncingEvent, setSyncingEvent] = useState(false);
  const [exportingEvent, setExportingEvent] = useState(false);

  const handleSyncAltegioInPopup = async () => {
    if (!selectedEvent) return;
    setSyncingEvent(true);
    try {
      await api.syncEventFromAltegio(selectedEvent.id);
      toast.success("синхронізовано");
      const r = await axios.get(`${API}/events/${selectedEvent.id}`);
      setSelectedEvent(r.data);
      refreshEvents();
    } catch { toast.error("помилка синхронізації"); }
    finally { setSyncingEvent(false); }
  };

  const handleExportCalendarInPopup = async () => {
    if (!selectedEvent) return;
    setExportingEvent(true);
    try {
      await api.exportEventToCalendar(selectedEvent.id);
      toast.success("додано до календаря");
      const r = await axios.get(`${API}/events/${selectedEvent.id}`);
      setSelectedEvent(r.data);
    } catch { toast.error("помилка експорту"); }
    finally { setExportingEvent(false); }
  };

  const handleOpenAltegioInPopup = async () => {
    if (!selectedEvent) return;
    try {
      const r = await api.getEventAltegioUrl(selectedEvent.id);
      const url = r.data?.activity_url || r.data?.url;
      if (!url) throw new Error("No Altegio URL");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch { toast.error("не вдалося відкрити Altegio"); }
  };

  const handleStandaloneTaskClick = (task) => {
    const fullTask = standaloneTasks.find(t => t.id === task.event_id);
    if (fullTask) { setSelectedStandaloneTask(fullTask); setShowStandaloneTaskPopup(true); }
  };

  const [activeDragTask, setActiveDragTask] = useState(null);
  const [dragPosition, setDragPosition] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const handleTaskDragStart = (task, point) => {
    setActiveDragTask(task);
    setDragPosition(point || null);
  };
  const handleTaskDragMove = ({ x, y, over }) => {
    setDragPosition({ x, y });
    setDragOver(over || null);
  };

  const persistTaskPlacement = async (task, assignee, date, order) => {
    if (task.is_standalone) {
      const full = standaloneTasks.find(t => t.id === task.event_id);
      if (!full) return;
      await api.updateStandaloneTaskFull(full.id, {
        title: full.title,
        date,
        icon: full.icon || task.icon || "coffee",
        type: full.type || task.type || "regular",
        color: full.color || task.color || "standard",
        assignee,
        event_id: full.event_id || task.event_id_link || "",
        order,
      });
      return;
    }
    const taskId = task.task_id || task.reminder_id;
    if (!taskId || taskId === "standalone") return;
    await api.updateEventTask(task.event_id, taskId, { date, assignee, order });
  };

  const handleTaskDrop = async (overData, draggedTask = null) => {
    const task = draggedTask || activeDragTask;
    if (!task) return;
    const findTaskByKey = (taskKey) => {
      if (!taskKey) return null;
      return Object.values(tasksByTeam).flatMap(group => Object.values(group).flat())
        .find(t => getTaskDragKey({ ...t, task_id: t.task_id || t.reminder_id }) === taskKey) || null;
    };
    const targetTask = overData.type === "task" ? (overData.task || findTaskByKey(overData.taskKey)) : null;
    const newAssignee = targetTask?.assignee || overData.assignee; // "manager" | "smm" | "marketer"
    const newDate = targetTask ? getTaskDate(targetTask) : (overData.date || getTaskDate(task));
    if (!["manager", "smm", "marketer"].includes(newAssignee)) return;
    if (overData.type === "task" || overData.type === "date") {
      const activeKey = getTaskDragKey(task);
      const targetKey = targetTask ? getTaskDragKey(targetTask) : null;
      if (targetKey && activeKey === targetKey && task.assignee === newAssignee && getTaskDate(task) === newDate) return;
      const targetColumnTasks = Object.values(tasksByTeam[newAssignee] || {}).flat();
      const targetDateTasks = targetColumnTasks
        .filter(t => getTaskDate(t) === newDate)
        .filter(t => getTaskDragKey({ ...t, task_id: t.task_id || t.reminder_id }) !== activeKey);
      const movedTask = {
        ...task,
        assignee: newAssignee,
        task_date: newDate,
        reminder_date: newDate,
      };
      const targetIndex = targetKey
        ? targetDateTasks.findIndex(t => getTaskDragKey({ ...t, task_id: t.task_id || t.reminder_id }) === targetKey)
        : -1;
      const insertAt = targetKey && targetIndex >= 0 ? targetIndex : targetDateTasks.length;
      targetDateTasks.splice(insertAt, 0, movedTask);
      try {
        const previousAssignee = task.assignee;
        const previousDate = getTaskDate(task);
        const previousOrder = getTaskOrder(task);
        await Promise.all(targetDateTasks.map((item, index) => persistTaskPlacement(item, newAssignee, newDate, (index + 1) * 1000)));
        pushUndo({ label: "перенесення таска", run: async () => { await persistTaskPlacement(task, previousAssignee, previousDate, previousOrder); refreshStandaloneTasks(); refreshEvents(); } });
        toast.success("порядок оновлено");
        refreshStandaloneTasks();
        refreshEvents();
      } catch {
        toast.error("не вдалось перенести");
      }
      return;
    }
    const labels = { manager: "Manager", smm: "SMM", marketer: "Marketer" };
    if (task.assignee === newAssignee) return;
    try {
      if (task.is_standalone) {
        // Find full standalone task and PATCH with new assignee
        const full = standaloneTasks.find(t => t.id === task.event_id);
        if (!full) return;
        await api.updateStandaloneTaskFull(full.id, {
          title: full.title,
          date: full.date,
          icon: full.icon || "coffee",
          type: full.type || "regular",
          color: full.color || "standard",
          assignee: newAssignee,
          event_id: full.event_id || "",
          order: full.order || 0,
        });
        pushUndo({ label: "перенесення таска", run: async () => { await api.updateStandaloneTaskFull(full.id, getStandaloneTaskPayload(full)); refreshStandaloneTasks(); } });
        toast.success(`перенесено на ${labels[newAssignee] || newAssignee}`);
        refreshStandaloneTasks();
      } else {
        const taskId = task.task_id || task.reminder_id;
        if (!taskId || taskId === "standalone") return;
        const previousAssignee = task.assignee;
        await api.updateEventTask(task.event_id, taskId, { assignee: newAssignee });
        pushUndo({ label: "перенесення таска", run: async () => { await api.updateEventTask(task.event_id, taskId, { assignee: previousAssignee }); refreshEvents(); } });
        toast.success(`перенесено на ${labels[newAssignee] || newAssignee}`);
        refreshEvents();
      }
    } catch { toast.error("не вдалось перенести"); }
  };

  const handleTaskDragEnd = () => {
    setActiveDragTask(null);
    setDragPosition(null);
    setDragOver(null);
  };

  const handleTaskEdit = (task) => {
    if (task.is_standalone) {
      const fullTask = standaloneTasks.find(t => t.id === task.event_id);
      if (fullTask) {
        setEditingStandaloneTask({...fullTask, _isStandalone: true, assignee: fullTask.assignee || task.assignee || 'manager'});
        setShowEditStandaloneDialog(true);
      }
    } else {
      // Event-based task
      const taskColor = task.color || "manager";
      const currentAssignee = task.assignee || 'manager';
      setEditingStandaloneTask({
        _isStandalone: false,
        _eventId: task.event_id,
        _taskId: task.task_id,
        assignee: currentAssignee,
        id: task.event_id,
        title: task.task_name,
        date: task.task_date,
        icon: task.icon || "circle",
        color: taskColor,
        type: "smm",
        completed: task.completed,
        eventTitle: task.event_title,
        order: task.order || 0,
      });
      setShowEditStandaloneDialog(true);
    }
  };

  const handleDeleteStandaloneTask = async () => {
    if (!selectedStandaloneTask) return;
    const before = { ...selectedStandaloneTask };
    try {
      await api.deleteStandaloneTask(selectedStandaloneTask.id);
      pushUndo({ label: "видалення таска", run: async () => { await api.createStandaloneTask(getStandaloneTaskPayload(before)); refreshStandaloneTasks(); } });
      toast.success("видалено!"); refreshStandaloneTasks(); setShowStandaloneTaskPopup(false);
    }
    catch { toast.error("помилка"); }
  };

  const handleCancelEvent = async (eventId) => {
    const ev = selectedEvent;
    const isSeries = !!ev?.source_event_id || ev?.event_type === "regular";
    if (isSeries) {
      // Defer to dialog — user picks "тільки цю" or "цю + наступні"
      setCancelSeriesDialogFor(ev);
      return;
    }
    const didCancel = await cancelEventAndArchive(ev || { id: eventId }, { refreshEvents, onDone: () => setShowEventDetail(false) });
    if (didCancel) pushUndo({ label: "скасування події", run: async () => { await axios.patch(`${API}/events/${eventId}`, { cancelled: false }); refreshEvents(); } });
  };

  const cancelSeriesOnlyThis = async () => {
    const id = cancelSeriesDialogFor?.id;
    if (!id) return;
    try {
      await axios.patch(`${API}/events/${id}`, { cancelled: true });
      toast.success("подію скасовано");
      setCancelSeriesDialogFor(null);
      setShowEventDetail(false);
      refreshEvents();
    } catch (error) {
      if (confirmCancellationGuard(error)) {
        try {
          await axios.patch(`${API}/events/${id}`, { cancelled: true, manager_confirmed_cancellation: true });
          toast.success("подію скасовано");
          setCancelSeriesDialogFor(null);
          setShowEventDetail(false);
          refreshEvents();
        } catch (retryError) { showCancellationGuardOrError(retryError); }
      } else showCancellationGuardOrError(error);
    }
  };

  const cancelSeriesAllFuture = async () => {
    const id = cancelSeriesDialogFor?.id;
    if (!id) return;
    try {
      const r = await api.cancelEventSeries(id);
      toast.success(`серію скасовано — ${r.data.cancelled_count} подій`);
      setCancelSeriesDialogFor(null);
      setShowEventDetail(false);
      refreshEvents();
    } catch (error) {
      if (confirmCancellationGuard(error)) {
        try {
          const r = await api.cancelEventSeries(id, true);
          toast.success(`серію скасовано — ${r.data.cancelled_count} подій`);
          setCancelSeriesDialogFor(null);
          setShowEventDetail(false);
          refreshEvents();
        } catch (retryError) { showCancellationGuardOrError(retryError); }
      } else showCancellationGuardOrError(error);
    }
  };

  const handleRestoreEvent = async (eventId) => {
    try {
      await axios.patch(`${API}/events/${eventId}`, { cancelled: false });
      toast.success("подію відновлено");
      refreshEvents();
      const r = await axios.get(`${API}/events/${eventId}`);
      setSelectedEvent(r.data);
    } catch { toast.error("помилка"); }
  };

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) return;
    try { const r = await api.createStandaloneTask({ ...newTask, type: "regular", assignee: newTask.assignee || (dialogColumnName === "SMM" ? "smm" : dialogColumnName === "Marketer" ? "marketer" : "manager"), event_id: newTask.event_id || "" }); if (r.data?.id) pushUndo({ label: "створення таска", run: async () => { await api.deleteStandaloneTask(r.data.id); refreshStandaloneTasks(); } }); toast.success("додано!"); refreshStandaloneTasks(); setShowTaskDialog(false); setNewTask({ title: "", date: todayStr, icon: "coffee", color: "manager", event_id: "", assignee: "manager" }); }
    catch { toast.error("помилка"); }
  };

  const handleCreateSMMTask = async () => {
    if (!newSMMTask.title.trim()) return;
    try {
      const r = await api.createStandaloneTask({
        ...newSMMTask,
        type: "smm",
        assignee: newSMMTask.assignee || (dialogColumnName === "SMM" ? "smm" : dialogColumnName === "Marketer" ? "marketer" : "manager"),
        event_id: newSMMTask.event_id || "",
      });
      if (r.data?.id) pushUndo({ label: "створення таска", run: async () => { await api.deleteStandaloneTask(r.data.id); refreshStandaloneTasks(); } });
      toast.success("додано!");
      refreshStandaloneTasks();
      setShowSMMTaskDialog(false);
      setNewSMMTask({ title: "", date: todayStr, icon: "instagram", color: "manager", event_id: "", assignee: "smm" });
    }
    catch { toast.error("помилка"); }
  };

  const handleSaveStandaloneTask = async () => {
    if (!editingStandaloneTask?.title?.trim()) return;
    const beforeStandalone = editingStandaloneTask._isStandalone === false ? null : standaloneTasks.find(t => t.id === editingStandaloneTask.id);
    const beforeEventTask = editingStandaloneTask._isStandalone === false ? { ...editingStandaloneTask } : null;
    try {
      if (editingStandaloneTask._isStandalone === false) {
        await axios.patch(`${API}/events/${editingStandaloneTask._eventId}/tasks/${editingStandaloneTask._taskId}`, {
          color: editingStandaloneTask.color,
          icon: editingStandaloneTask.icon,
          title: editingStandaloneTask.title,
          assignee: editingStandaloneTask.assignee,
          date: editingStandaloneTask.date,
          order: editingStandaloneTask.order || 0,
        });
        pushUndo({ label: "редагування таска", run: async () => { await api.updateEventTask(beforeEventTask._eventId, beforeEventTask._taskId, { color: beforeEventTask.color, icon: beforeEventTask.icon, title: beforeEventTask.title, assignee: beforeEventTask.assignee, date: beforeEventTask.date, order: beforeEventTask.order || 0 }); refreshEvents(); } });
        toast.success("збережено!");
        refreshEvents();
      } else {
        await api.updateStandaloneTaskFull(editingStandaloneTask.id, {
          title: editingStandaloneTask.title,
          date: editingStandaloneTask.date,
          icon: editingStandaloneTask.icon,
          type: editingStandaloneTask.type,
          color: editingStandaloneTask.color,
          assignee: editingStandaloneTask.assignee || 'manager',
          event_id: editingStandaloneTask.event_id || "",
          order: editingStandaloneTask.order || 0,
        });
        if (beforeStandalone) pushUndo({ label: "редагування таска", run: async () => { await api.updateStandaloneTaskFull(beforeStandalone.id, getStandaloneTaskPayload(beforeStandalone)); refreshStandaloneTasks(); } });
        toast.success("збережено!");
        refreshStandaloneTasks();
      }
      setShowEditStandaloneDialog(false);
      setEditingStandaloneTask(null);
    } catch { toast.error("помилка"); }
  };

  const handleRescheduleStandaloneTask = async (nextDate) => {
    if (!editingStandaloneTask?.title?.trim() || !nextDate) return;
    const beforeStandalone = editingStandaloneTask._isStandalone === false ? null : standaloneTasks.find(t => t.id === editingStandaloneTask.id);
    const beforeEventTask = editingStandaloneTask._isStandalone === false ? { ...editingStandaloneTask } : null;
    const task = { ...editingStandaloneTask, date: nextDate };
    setReschedulingTaskDate(nextDate);
    try {
      if (task._isStandalone === false) {
        await axios.patch(`${API}/events/${task._eventId}/tasks/${task._taskId}`, {
          color: task.color,
          icon: task.icon,
          title: task.title,
          assignee: task.assignee,
          date: task.date,
          order: task.order || 0,
        });
        pushUndo({ label: "перенесення таска", run: async () => { await api.updateEventTask(beforeEventTask._eventId, beforeEventTask._taskId, { color: beforeEventTask.color, icon: beforeEventTask.icon, title: beforeEventTask.title, assignee: beforeEventTask.assignee, date: beforeEventTask.date, order: beforeEventTask.order || 0 }); refreshEvents(); } });
        refreshEvents();
      } else {
        await api.updateStandaloneTaskFull(task.id, {
          title: task.title,
          date: task.date,
          icon: task.icon,
          type: task.type,
          color: task.color,
          assignee: task.assignee || 'manager',
          event_id: task.event_id || "",
          order: task.order || 0,
        });
        if (beforeStandalone) pushUndo({ label: "перенесення таска", run: async () => { await api.updateStandaloneTaskFull(beforeStandalone.id, getStandaloneTaskPayload(beforeStandalone)); refreshStandaloneTasks(); } });
        refreshStandaloneTasks();
      }
      toast.success("перенесено!");
      setShowEditCalendar(false);
      setShowEditStandaloneDialog(false);
      setEditingStandaloneTask(null);
    } catch {
      toast.error("помилка");
    } finally {
      setReschedulingTaskDate(null);
    }
  };

  const handleDeleteEditingTask = useCallback(async () => {
    if (!editingStandaloneTask) return;
    const before = { ...editingStandaloneTask };
    try {
      if (editingStandaloneTask._isStandalone === false) {
        await api.deleteEventTask(editingStandaloneTask._eventId, editingStandaloneTask._taskId);
        pushUndo({ label: "видалення таска", run: async () => { await api.updateEventTask(before._eventId, before._taskId, { color: before.color, icon: before.icon, title: before.title, assignee: before.assignee, date: before.date, order: before.order || 0, deleted: false }); refreshEvents(); } });
        refreshEvents();
      } else {
        await api.deleteStandaloneTask(editingStandaloneTask.id);
        pushUndo({ label: "видалення таска", run: async () => { await api.createStandaloneTask(getStandaloneTaskPayload(before)); refreshStandaloneTasks(); } });
        refreshStandaloneTasks();
      }
      toast.success("видалено!");
      setShowEditStandaloneDialog(false);
      setEditingStandaloneTask(null);
    } catch {
      toast.error("помилка");
    }
  }, [editingStandaloneTask, refreshEvents, refreshStandaloneTasks, pushUndo]);

  // Keyboard shortcut for save (Ctrl/Cmd + Enter)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (showTaskDialog && newTask.title.trim()) {
          e.preventDefault();
          handleCreateTask();
        } else if (showSMMTaskDialog && newSMMTask.title.trim()) {
          e.preventDefault();
          handleCreateSMMTask();
        } else if (showEditStandaloneDialog && editingStandaloneTask?.title?.trim()) {
          e.preventDefault();
          handleSaveStandaloneTask();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTaskDialog, showSMMTaskDialog, showEditStandaloneDialog, newTask, newSMMTask, editingStandaloneTask]);

  // Delete shortcut in the edit dialog: d (latin) / в (Ukrainian).
  useEffect(() => {
    if (!showEditStandaloneDialog || showEditCalendar) return;
    const handleDeleteKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const key = String(e.key || '').toLowerCase();
      if (key !== 'd' && key !== 'в') return;
      e.preventDefault();
      handleDeleteEditingTask();
    };
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [showEditStandaloneDialog, showEditCalendar, editingStandaloneTask, handleDeleteEditingTask]);

  // Digit shortcuts in the edit dialog: 0 = today, 1 = tomorrow, … 9 = +9d.
  // Calls the same reschedule handler the chips use, so the popup closes on
  // success. Skipped while focused on input/textarea so title editing isn't
  // hijacked, and skipped if any modifier is held (those are for save etc.).
  useEffect(() => {
    if (!showEditStandaloneDialog) return;
    const handleDigit = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const isTodayShortcut = e.code === 'Backquote' || e.key === '`' || e.key === 'ʼ' || e.key === '0';
      if (isTodayShortcut) {
        if (!editingStandaloneTask?.title?.trim()) return;
        e.preventDefault();
        handleRescheduleStandaloneTask(todayStr);
        return;
      }
      const d = parseInt(e.key, 10);
      if (Number.isNaN(d) || d < 0 || d > 9) return;
      if (!editingStandaloneTask?.title?.trim()) return;
      e.preventDefault();
      handleRescheduleStandaloneTask(shiftDateLocal(todayStr, d));
    };
    window.addEventListener('keydown', handleDigit);
    return () => window.removeEventListener('keydown', handleDigit);
  }, [showEditStandaloneDialog, editingStandaloneTask, todayStr]);

  return (
    <div className="desktop-dashboard">
      <header className="desktop-header">
        <div className="desktop-header-left gap-4">
          <h1 className="logo" style={{ textTransform: 'none' }}>Poriadok</h1>
          <span className="desktop-date-label text-sm text-secondary lowercase">{todayFormatted.weekday} • {todayFormatted.day} {todayFormatted.month}</span>
        </div>
        <div className="desktop-header-right">
          <button className="desktop-header-btn" onClick={() => setShowStats(true)} title="Аналітика" data-testid="analytics-btn"><BarChart3 className="w-5 h-5" /></button>
          <button className="desktop-header-btn" onClick={() => navigate("/content")} title="Контент" data-testid="content-btn"><FileText className="w-5 h-5" /></button>
          <button className="desktop-header-btn" onClick={() => setShowDayOffDialog(true)} title="Вихідний" data-testid="dayoff-btn"><Coffee className="w-5 h-5" /></button>
          <button className="btn-dark" onClick={() => navigate("/event/new")}><Plus className="w-4 h-4" /><span>подія</span></button>
          <button className="desktop-header-btn" onClick={() => setShowSettings(true)} title="Налаштування"><Settings className="w-5 h-5" /></button>
        </div>
      </header>

      {/* Main Content - 4 columns */}
      <div className="desktop-columns-4">
          {/* Events Column */}
          <div className="desktop-column">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-wide" style={{color:'#1A1717'}}>ПОДІЇ</span>
                <div className="flex items-center gap-1">
                  <button className="p-0.5 hover:bg-black/5 rounded-full transition-colors" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}><ChevronLeft className="w-3.5 h-3.5 text-secondary" /></button>
                  <span className="text-xs font-medium text-secondary min-w-[60px] text-center">{UK_MONTHS_NOMINATIVE[currentMonth.getMonth()]}</span>
                  <button className="p-0.5 hover:bg-black/5 rounded-full transition-colors" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}><ChevronRight className="w-3.5 h-3.5 text-secondary" /></button>
                </div>
              </div>
              <button
                className="p-1.5 rounded-full hover:bg-black/5 transition-colors text-secondary"
                onClick={() => navigate("/events")}
                title="розгорнути на весь екран"
                data-testid="events-expand-btn"
              ><Maximize2 className="w-4 h-4" /></button>
            </div>
            <div className="column-content">
              <div className="calendar-container-desktop">
                <Calendar mode="single" locale={uk} weekStartsOn={1} month={currentMonth} onMonthChange={setCurrentMonth} onSelect={handleDateClick} className="w-full calendar-minimal calendar-wide !p-1"
                  classNames={{ month: "space-y-0 w-full", caption: "hidden", row: "flex w-full", head_row: "flex w-full", table: "w-full border-collapse" }}
                  modifiersClassNames={{ today: "calendar-today-visible" }}
                  components={{ DayContent: ({ date }) => {
                    return renderEventCalendarDay(date, events, currentMonth, today);
                  }}}
                />
              </div>
              <div className="events-list">{allEvents.slice(0, 10).map(event => {
                const eventDate = new Date(event.date);
                return (
                  <div key={event.id} className={`event-card-desktop${getEventArchiveClass(event, today)}`} onClick={() => handleEventClick(event.id)} data-event-date={event.date.split('T')[0]}>
                    <div className="date-badge-desktop">
                      <span className="date-badge-month">{['нд','пн','вт','ср','чт','пт','сб'][eventDate.getDay()]}</span>
                      <span className="date-badge-day">{eventDate.getDate()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{event.title}</p>
                      <p className="text-xs text-secondary">{event.price} ₴</p>
                    </div>
                    <EventArchiveIcon event={event} today={today} />
                    <div className="text-right">
                      <span className={`text-sm font-bold ${getBookingColorClass(getBookingStatusColor(event))}`}>
                        {event.altegio_booked_count != null ? event.altegio_booked_count : 0}/{event.spots || 10}
                      </span>
                    </div>
                  </div>
                );
              })}</div>
            </div>
          </div>

          {/* MANAGER + SMM + MARKETER — drag between days/columns */}
          <TeamColumn
            name="MANAGER"
            tasks={tasksByTeam.manager}
            colorClass=""
            colorHex={null}
            onToggle={(eventId, taskId, completed, isStandalone) => {
              if (isStandalone || taskId === "standalone") {
                handleToggleSMMTask(eventId, taskId, completed, isStandalone);
              } else {
                handleToggleTask(eventId, taskId, completed, isStandalone);
              }
            }}
            onEventClick={handleEventClick}
            onStandaloneClick={handleStandaloneTaskClick}
            onTaskEdit={handleTaskEdit}
            onAddClick={() => { setNewTask({ title: "", date: todayStr, icon: "coffee", color: "manager", event_id: "", assignee: "manager" }); setDialogColumnName("Manager"); setShowTaskDialog(true); }}
            overdueExpanded={managerOverdue}
            setOverdueExpanded={setManagerOverdue}
            soonExpanded={managerSoon}
            setSoonExpanded={setManagerSoon}
            smmTasksDefinition={smmTasksDefinition}
            columnAssignee="manager"
            todayStr={todayStr}
            onTaskDragStart={handleTaskDragStart}
            onTaskDragMove={handleTaskDragMove}
            onTaskDragEnd={handleTaskDragEnd}
            onTaskDrop={handleTaskDrop}
            dragOver={dragOver}
          />

          {/* SMM Column - Second */}
          <TeamColumn
            name="SMM"
            tasks={tasksByTeam.smm}
            colorClass=""
            colorHex={null}
            onToggle={handleToggleSMMTask}
            onEventClick={handleEventClick}
            onStandaloneClick={handleStandaloneTaskClick}
            onTaskEdit={handleTaskEdit}
            onAddClick={() => { setNewSMMTask({ title: "", date: todayStr, icon: "instagram", color: "manager", event_id: "", assignee: "smm" }); setDialogColumnName("SMM"); setShowSMMTaskDialog(true); }}
            overdueExpanded={smmOverdue}
            setOverdueExpanded={setSMMOverdue}
            soonExpanded={smmSoon}
            setSoonExpanded={setSMMSoon}
            smmTasksDefinition={smmTasksDefinition}
            columnAssignee="smm"
            todayStr={todayStr}
            announcementOverlaps={announcementOverlaps}
            onOverlapClick={setOverlapResolverTask}
            onTaskDragStart={handleTaskDragStart}
            onTaskDragMove={handleTaskDragMove}
            onTaskDragEnd={handleTaskDragEnd}
            onTaskDrop={handleTaskDrop}
            dragOver={dragOver}
          />

          {/* MARKETER Column (orange) - Third */}
          <TeamColumn
            name="MARKETER"
            tasks={tasksByTeam.marketer}
            colorClass="orange"
            colorHex="#C4703D"
            onToggle={handleToggleSMMTask}
            onEventClick={handleEventClick}
            onStandaloneClick={handleStandaloneTaskClick}
            onTaskEdit={handleTaskEdit}
            onAddClick={() => { setNewSMMTask({ title: "", date: todayStr, icon: "instagram", color: "manager", event_id: "", assignee: "marketer" }); setDialogColumnName("Marketer"); setShowSMMTaskDialog(true); }}
            overdueExpanded={marketerOverdue}
            setOverdueExpanded={setVoOverdue}
            soonExpanded={marketerSoon}
            setSoonExpanded={setVoSoon}
            smmTasksDefinition={smmTasksDefinition}
            columnAssignee="marketer"
            todayStr={todayStr}
            onTaskDragStart={handleTaskDragStart}
            onTaskDragMove={handleTaskDragMove}
            onTaskDragEnd={handleTaskDragEnd}
            onTaskDrop={handleTaskDrop}
            dragOver={dragOver}
          />
          {activeDragTask && dragPosition && (
            <div
              className="fixed z-[9999] pointer-events-none px-3 py-2 rounded-xl bg-[#F1EEE7] shadow-[0_16px_40px_-8px_rgba(0,0,0,0.25)] ring-1 ring-black/10 select-none max-w-xs"
              style={{ left: dragPosition.x + 12, top: dragPosition.y + 12, transform: "rotate(-2deg)" }}
            >
              <p className="text-sm font-medium truncate">{activeDragTask.task_name || activeDragTask.reminder_name || "задача"}</p>
              {activeDragTask.event_title && (
                <p className="text-xs text-secondary truncate mt-0.5">{activeDragTask.event_title}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="desktop-columns">
          {/* Events Tab - Full Calendar & Events List */}
          <div className="desktop-column" style={{flex: 1}}>
            <div className="column-content">
              <div className="calendar-container-desktop">
                <Calendar mode="single" locale={uk} weekStartsOn={1} month={currentMonth} onMonthChange={setCurrentMonth} onSelect={handleDateClick} className="w-full calendar-minimal calendar-wide !p-1"
                  classNames={{ month: "space-y-0 w-full", caption: "hidden", row: "flex w-full", head_row: "flex w-full", table: "w-full border-collapse" }}
                  modifiersClassNames={{ today: "calendar-today-visible" }}
                  components={{ DayContent: ({ date }) => {
                    return renderEventCalendarDay(date, events, currentMonth, today);
                  }}}
                />
              </div>
            </div>
          </div>
          <div className="desktop-column" style={{flex: 2}}>
            <div className="column-header">
              <span className="column-title">всі події</span>
              <button className="add-btn" onClick={() => navigate("/event/new")}><Plus className="w-4 h-4" /></button>
            </div>
            <div className="column-content">
              <div className="events-list">{allEvents.map(event => {
                const eventDate = new Date(event.date);
                return (
                  <div key={event.id} className={`event-card-desktop${getEventArchiveClass(event, today)}`} onClick={() => handleEventClick(event.id)} data-event-date={event.date.split('T')[0]}>
                    <div className="date-badge-desktop">
                      <span className="date-badge-month">{UK_MONTHS_SHORT[eventDate.getMonth()]}</span>
                      <span className="date-badge-day">{eventDate.getDate()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{event.title}</p>
                      <p className="text-xs text-secondary">{event.price} ₴</p>
                    </div>
                    <EventArchiveIcon event={event} today={today} />
                    {event.altegio_booked_count !== undefined && event.altegio_booked_count !== null && (
                      <div className="text-right">
                        <span className={`text-sm font-bold ${getBookingColorClass(getBookingStatusColor(event))}`}>
                          {event.altegio_booked_count}/{event.spots}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}</div>
            </div>
          </div>
      </div>

      {/* Dialogs */}
      <Dialog open={showTaskDialog} onOpenChange={setShowTaskDialog}>
        <DialogContent className="sm:max-w-[420px] !p-5 sm:!p-6">
          {(() => {
            const PALETTE = [
              {c:'manager',bg:'#1A1717'}, {c:'red',bg:'#FF8370'}, {c:'purple',bg:'#9333EA'},
              {c:'smm',bg:'#059669'}, {c:'blue',bg:'#3B82F6'}, {c:'orange',bg:'#C4703D'},
              {c:'pink',bg:'#FF8370'}, {c:'teal',bg:'#14B8A6'},
            ];
            const COLOR_MAP = Object.fromEntries(PALETTE.map(p => [p.c, p.bg]));
            const selectedHex = COLOR_MAP[newTask.color] || '#1A1717';
            const today = new Date();
            const dt = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return formatDateLocal(d); };
            const dateChips = [
              { label: "сьогодні", value: dt(0) },
              { label: "завтра",  value: dt(1) },
              { label: "+3д",     value: dt(3) },
              { label: "+1 тиж",  value: dt(7) },
            ];
            const isCustomDate = !dateChips.some(c => c.value === newTask.date);
            return (
              <>
                {/* Header inline: title + assignee chip + event chip */}
                <div className="flex items-baseline gap-2 mb-4 pr-10 flex-wrap">
                  <DialogTitle className="text-[20px] font-semibold tracking-tight">нове завдання</DialogTitle>
                  <span className="relative inline-flex items-center text-[11px] font-medium text-[#1A1717]/55">
                    <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: selectedHex }} />
                    <select
                      value={newTask.assignee || "manager"}
                      onChange={(e) => {
                        const a = e.target.value;
                        setNewTask({ ...newTask, assignee: a });
                        setDialogColumnName(a === "smm" ? "SMM" : a === "marketer" ? "Marketer" : "Manager");
                      }}
                      className="appearance-none bg-transparent cursor-pointer outline-none border-none pr-3.5 text-[11px] uppercase tracking-wider"
                    >
                      <option value="manager">Manager</option>
                      <option value="smm">SMM</option>
                      <option value="marketer">Marketer</option>
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </span>
                  <span className="relative inline-flex items-center text-[11px] font-medium text-[#1A1717]/55 max-w-[180px]">
                    <span className="mr-1 opacity-50">·</span>
                    <select
                      value={newTask.event_id || ""}
                      onChange={(e) => setNewTask({ ...newTask, event_id: e.target.value })}
                      className="appearance-none bg-transparent cursor-pointer outline-none border-none pr-3.5 text-[11px] uppercase tracking-wider truncate"
                    >
                      <option value="">— без події</option>
                      {[...events]
                        .filter(e => !e.cancelled)
                        .sort((a, b) => new Date(a.date) - new Date(b.date))
                        .map(ev => {
                          const d = new Date(ev.date);
                          return <option key={ev.id} value={ev.id}>{`${d.getDate()} ${UK_MONTHS_NOMINATIVE[d.getMonth()]} — ${ev.title}`}</option>;
                        })}
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </span>
                </div>

                {/* Title input */}
                <Input
                  autoFocus
                  placeholder="що треба зробити?"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && newTask.title?.trim()) handleCreateTask(); }}
                  className="w-full h-12 px-4 rounded-xl bg-[#F1EEE7] border-2 border-transparent text-[15px] placeholder:text-[#1A1717]/35 focus:outline-none focus:border-[#1A1717] transition-colors"
                  data-testid="new-task-title"
                />

                {/* Date chips — single row */}
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-hide">
                  {dateChips.map(chip => {
                    const sel = newTask.date === chip.value;
                    return (
                      <button
                        key={chip.value}
                        type="button"
                        onClick={() => setNewTask({ ...newTask, date: chip.value })}
                        className={`shrink-0 h-9 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
                          sel ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 hover:ring-black/25'
                        }`}
                        data-testid={`new-task-date-${chip.label}`}
                      >{chip.label}</button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowTaskCalendar(true)}
                    className={`shrink-0 h-9 px-3.5 rounded-full text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
                      isCustomDate ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 hover:ring-black/25'
                    }`}
                    data-testid="new-task-date-custom"
                  >
                    <CalendarIcon className="w-3 h-3" />
                    {isCustomDate ? formatDateUkrainian(newTask.date) : 'інша'}
                  </button>
                </div>

                {/* Icons (left, big grid) + colors (right, tight vertical strip) */}
                <div className="mt-4 p-3 rounded-2xl bg-[#F1EEE7] ring-1 ring-black/[0.06] flex gap-3">
                  <div className="flex-1 grid grid-cols-7 gap-1.5">
                    {CUSTOM_TASK_ICONS.map(opt => {
                      const sel = newTask.icon === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setNewTask({ ...newTask, icon: opt.value })}
                          className="aspect-square rounded-xl flex items-center justify-center transition-colors active:scale-95"
                          style={{
                            background: sel ? selectedHex : 'transparent',
                            color: sel ? '#FFFFFF' : '#1A1717',
                            boxShadow: sel ? `0 4px 10px ${selectedHex}40` : 'none',
                          }}
                          data-testid={`new-task-icon-${opt.value}`}
                        ><opt.Icon className="w-4 h-4" /></button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 self-center pl-3 border-l border-black/[0.06]">
                    {PALETTE.map(({c,bg}) => {
                      const sel = newTask.color === c || (c === 'manager' && (!newTask.color || newTask.color === 'standard'));
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewTask({...newTask, color: c})}
                          className="rounded-full transition-colors active:scale-95 flex items-center justify-center"
                          style={{ width: 18, height: 18 }}
                          aria-label={c}
                          data-testid={`new-task-color-${c}`}
                        >
                          <span className="rounded-full block"
                            style={{
                              width: sel ? 12 : 14, height: sel ? 12 : 14, background: bg,
                              boxShadow: sel ? `0 0 0 2px #FFFFFF, 0 0 0 3.5px ${bg}` : 'none',
                            }} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* (Event picker is now in the header chip-row) */}

                {/* CTA */}
                <button
                  onClick={handleCreateTask}
                  disabled={!newTask.title?.trim()}
                  className="mt-4 w-full h-12 rounded-full bg-[#1A1717] text-[#F6F5F1] font-medium text-[14px] transition-colors hover:bg-[#2a2424] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 active:scale-[0.98]"
                  data-testid="new-task-create"
                >
                  створити <ChevronRight className="w-4 h-4" />
                </button>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={showTaskCalendar} onOpenChange={setShowTaskCalendar}>
        <DialogContent className="dialog-content">
          <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(newTask.date)} onSelect={(d) => { if (d) { setNewTask({ ...newTask, date: formatDateLocal(d) }); } setShowTaskCalendar(false); }} className="w-full" />
        </DialogContent>
      </Dialog>

      <Dialog open={showSMMCalendar} onOpenChange={setShowSMMCalendar}>
        <DialogContent className="dialog-content">
          <Calendar mode="single" locale={uk} weekStartsOn={1} selected={new Date(newSMMTask.date)} onSelect={(d) => { if (d) { setNewSMMTask({ ...newSMMTask, date: formatDateLocal(d) }); } setShowSMMCalendar(false); }} className="w-full" />
        </DialogContent>
      </Dialog>

      {/* Event Detail Fullscreen */}
      <FullscreenModal isOpen={showEventDetail} onClose={() => setShowEventDetail(false)} title={selectedEvent?.title || "подія"}>
        {selectedEvent && (
          <div className="desktop-columns-4">
            {/* Column 1 - Event Info */}
            <div className="desktop-column">
              <div className="px-4 py-3 flex items-center justify-between gap-2 relative">
                {seriesData && seriesData.events && seriesData.events.length > 1 ? (
                  <>
                    <span className="text-sm font-semibold tracking-wide">РЕГУЛЯРНА ПОДІЯ</span>
                    <button
                      type="button"
                      onClick={() => setSeriesPickerOpen(o => !o)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/5 hover:bg-black/10 text-xs font-medium transition-colors"
                      data-testid="series-picker-toggle"
                    >
                      <span className="tabular-nums">{seriesData.events.length} подій</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${seriesPickerOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {seriesPickerOpen && (
                      <div
                        className="absolute right-2 top-full mt-1 z-30 w-72 rounded-2xl bg-[#F1EEE7] ring-1 ring-black/8 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.18)] p-1.5 max-h-80 overflow-y-auto"
                      >
                        {seriesData.events.map((inst) => {
                          const d = new Date(inst.date);
                          const dayLabel = `${d.getDate()} ${UK_MONTHS_NOMINATIVE[d.getMonth()]}`;
                          const wd = ['нд','пн','вт','ср','чт','пт','сб'][d.getDay()];
                          const isPast = d < today;
                          const isCancelled = inst.cancelled;
                          const isCurrent = inst.is_current;
                          const isMaster = inst.is_master;
                          const bookings = inst.altegio_booked_count;
                          const cap = inst.spots || 10;
                          return (
                            <button
                              key={inst.id}
                              onClick={() => { setSeriesPickerOpen(false); if (!isCurrent) handleEventClick(inst.id); }}
                              disabled={isCurrent}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
                                isCurrent
                                  ? 'bg-[#1A1717] text-[#F6F5F1] cursor-default'
                                  : isCancelled
                                    ? 'text-[#1A1717]/35 line-through hover:bg-black/5'
                                    : isPast
                                      ? 'text-[#1A1717]/55 hover:bg-black/5'
                                      : 'hover:bg-black/5'
                              }`}
                              data-testid={`series-instance-${inst.id}`}
                            >
                              <span className="font-medium tabular-nums w-20">{dayLabel}</span>
                              <span className={`text-[11px] uppercase ${isCurrent ? 'text-[#F6F5F1]/70' : 'text-secondary'}`}>{wd}</span>
                              {isMaster && <span className="text-[10px] uppercase tracking-wider opacity-60">батько</span>}
                              <span className="ml-auto text-xs tabular-nums">
                                {bookings != null ? `${bookings}/${cap}` : `–/${cap}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-sm font-semibold tracking-wide">ПОДІЯ</span>
                )}
              </div>
              <div className="column-content">
                <div className="section-card">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                      <span className="text-secondary text-sm">дата</span>
                      <span className="font-medium">{formatDateUkrainian(selectedEvent.date)}</span>
                    </div>
                    {selectedEvent.start_time && (
                      <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                        <span className="text-secondary text-sm">час</span>
                        <span className="font-medium">{selectedEvent.start_time}{selectedEvent.end_time ? ` — ${selectedEvent.end_time}` : ''}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                      <span className="text-secondary text-sm">ціна</span>
                      <span className="font-medium">{selectedEvent.price} ₴</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                      <span className="text-secondary text-sm">учасники</span>
                      {(selectedEvent.altegio_booked_count !== null && selectedEvent.altegio_booked_count !== undefined) ? (
                        <span className={`font-bold ${getBookingColorClass(getBookingStatusColor(selectedEvent))}`}>
                          {selectedEvent.altegio_booked_count}/{selectedEvent.spots || 10}
                        </span>
                      ) : (
                        <span className="font-medium">0/{selectedEvent.spots || 10}</span>
                      )}
                    </div>
                    {selectedEvent.description && (
                      <div className="py-2">
                        <span className="text-secondary text-sm block mb-1">опис</span>
                        <p className="text-sm">{selectedEvent.description}</p>
                      </div>
                    )}
                  </div>
                  {selectedEvent.cancelled && (
                    <div className="mt-4 p-3 bg-red-50 rounded-lg text-center">
                      <p className="text-red-600 font-medium">подію скасовано</p>
                    </div>
                  )}
                </div>

                {/* Compact series picker — replaces the column header for series events */}

                <div className="section-card mt-4">
                  <p className="text-xs text-secondary mb-3">синхронізація</p>
                  <div className="flex gap-2">
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition-colors" onClick={handleExportCalendarInPopup} disabled={exportingEvent}>
                      <ExternalLink className="w-4 h-4" /><span>{exportingEvent ? "..." : "Calendar"}</span>
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition-colors" onClick={handleSyncAltegioInPopup} disabled={syncingEvent}>
                      <RefreshCw className={`w-4 h-4 ${syncingEvent ? 'animate-spin' : ''}`} /><span>{syncingEvent ? "..." : "Altegio"}</span>
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition-colors" onClick={handleOpenAltegioInPopup}>
                      <ExternalLink className="w-4 h-4" /><span>відкрити</span>
                    </button>
                  </div>
                  {selectedEvent.altegio_last_sync && (
                    <p className="text-xs text-secondary mt-2 text-center">оновлено: {new Date(selectedEvent.altegio_last_sync).toLocaleString('uk-UA')}</p>
                  )}
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" className="flex-1" onClick={() => { setShowEventDetail(false); navigate(`/event/${selectedEvent.id}`); }}>
                    <Edit className="w-4 h-4 mr-2" />редагувати
                  </Button>
                  {!selectedEvent.cancelled ? (
                    <Button variant="outline" className="flex-1 text-orange-600 border-orange-200 hover:bg-orange-50" onClick={() => handleCancelEvent(selectedEvent.id)}>
                      <X className="w-4 h-4 mr-2" />скасувати
                    </Button>
                  ) : (
                    <Button variant="outline" className="flex-1 text-green-600 border-green-200 hover:bg-green-50" onClick={() => handleRestoreEvent(selectedEvent.id)}>
                      <RotateCcw className="w-4 h-4 mr-2" />відновити
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Column 2 - MANAGER */}
            <div className="desktop-column">
              <div className="px-4 py-3">
                <span className="text-sm font-semibold tracking-wide">MANAGER</span>
              </div>
              <div className="column-content">
                <div className="space-y-2">
                  {(allTaskDefs.management || []).map(rt => {
                    const reminderDate = selectedEvent.reminders?.[rt.id];
                    const isCompleted = !!selectedEvent.completed_tasks?.[rt.id];
                    if (!reminderDate) return null;
                    const IconComponent = getIconComponent(rt.icon || "circle");
                    const condBadge = formatTaskCondition(rt.condition);
                    return (
                      <div key={rt.id} className="task-item" onClick={() => handleToggleTaskInPopup(rt.id, !isCompleted)}>
                        <div className="task-icon"><IconComponent /></div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${isCompleted ? "opacity-50" : ""}`}>{rt.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-xs text-secondary">{formatDateUkrainian(reminderDate)}</p>
                            {condBadge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/8 text-[#1A1717]/65 font-medium">{condBadge}</span>}
                          </div>
                        </div>
                        <button className={`task-checkbox ${isCompleted ? "checked" : ""}`}><Check className="w-4 h-4" /></button>
                      </div>
                    );
                  })}
                  {!(allTaskDefs.management || []).some(rt => selectedEvent.reminders?.[rt.id]) && (
                    <p className="text-secondary text-sm py-4">немає завдань</p>
                  )}
                </div>
              </div>
            </div>

            {/* Column 3 - SMM */}
            <div className="desktop-column">
              <div className="px-4 py-3">
                <span className="text-sm font-semibold tracking-wide">SMM</span>
              </div>
              <div className="column-content">
                <div className="space-y-2">
                  {smmTasksDefinition.map(t => {
                    const taskDate = selectedEvent.smm_tasks?.[t.id];
                    const isCompleted = !!selectedEvent.completed_smm_tasks?.[t.id];
                    if (!taskDate) return null;
                    const isTextWork = TEXT_WORK_SMM_TASKS.has(t.id);
                    const iconName = isTextWork ? "file" : (SMM_ICONS[t.id] || "circle");
                    const IconComponent = getIconComponent(iconName);
                    const condBadge = formatTaskCondition(t.condition);
                    return (
                      <div key={t.id} className="task-item" onClick={() => handleToggleSMMTaskInPopup(t.id, !isCompleted)}>
                        <div className="task-icon"><IconComponent /></div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${isCompleted ? "opacity-50" : ""}`}>{t.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-xs text-secondary">{formatDateUkrainian(taskDate)}</p>
                            {condBadge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/8 text-[#1A1717]/65 font-medium">{condBadge}</span>}
                          </div>
                        </div>
                        <button className={`task-checkbox ${isCompleted ? "checked" : ""}`}><Check className="w-4 h-4" /></button>
                      </div>
                    );
                  })}
                  {!smmTasksDefinition.some(t => selectedEvent.smm_tasks?.[t.id]) && (
                    <p className="text-secondary text-sm py-4">немає smm завдань</p>
                  )}
                </div>
              </div>
            </div>

            {/* Column 4 - MARKETER */}
            <div className="desktop-column">
              <div className="px-4 py-3">
                <span className="text-sm font-semibold tracking-wide">MARKETER</span>
              </div>
              <div className="column-content">
                <div className="space-y-2">
                  {(allTaskDefs.marketing || []).map(t => {
                    const taskDate = selectedEvent.marketing_tasks?.[t.id];
                    const isCompleted = !!selectedEvent.completed_marketing_tasks?.[t.id];
                    if (!taskDate) return null;
                    const IconComponent = getIconComponent(t.icon || "circle");
                    const condBadge = formatTaskCondition(t.condition);
                    return (
                      <div key={t.id} className="task-item" onClick={async () => {
                        try {
                          await api.completeMarketingTask({ event_id: selectedEvent.id, task_id: t.id, completed: !isCompleted });
                          refreshEvents();
                          const r = await axios.get(`${API}/events/${selectedEvent.id}`);
                          setSelectedEvent(r.data);
                        } catch { toast.error("помилка"); }
                      }}>
                        <div className="task-icon"><IconComponent /></div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${isCompleted ? "opacity-50" : ""}`}>{t.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-xs text-secondary">{formatDateUkrainian(taskDate)}</p>
                            {condBadge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/8 text-[#1A1717]/65 font-medium">{condBadge}</span>}
                          </div>
                        </div>
                        <button className={`task-checkbox ${isCompleted ? "checked" : ""}`}><Check className="w-4 h-4" /></button>
                      </div>
                    );
                  })}
                  {!(allTaskDefs.marketing || []).some(t => selectedEvent.marketing_tasks?.[t.id]) && (
                    <p className="text-secondary text-sm py-4">немає маркетинг завдань</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </FullscreenModal>

      <Dialog open={showSMMTaskDialog} onOpenChange={setShowSMMTaskDialog}>
        <DialogContent className="sm:max-w-[420px] !p-5 sm:!p-6">
          {(() => {
            const PALETTE = [
              {c:'manager',bg:'#1A1717'}, {c:'red',bg:'#FF8370'}, {c:'purple',bg:'#9333EA'},
              {c:'smm',bg:'#059669'}, {c:'blue',bg:'#3B82F6'}, {c:'orange',bg:'#C4703D'},
              {c:'pink',bg:'#FF8370'}, {c:'teal',bg:'#14B8A6'},
            ];
            const COLOR_MAP = Object.fromEntries(PALETTE.map(p => [p.c, p.bg]));
            const selectedHex = COLOR_MAP[newSMMTask.color] || '#1A1717';
            const today = new Date();
            const dt = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return formatDateLocal(d); };
            const dateChips = [
              { label: "сьогодні", value: dt(0) },
              { label: "завтра",  value: dt(1) },
              { label: "+3д",     value: dt(3) },
              { label: "+1 тиж",  value: dt(7) },
            ];
            const isCustomDate = !dateChips.some(c => c.value === newSMMTask.date);
            return (
              <>
                <div className="flex items-baseline gap-2 mb-4 pr-10 flex-wrap">
                  <DialogTitle className="text-[20px] font-semibold tracking-tight">нове завдання</DialogTitle>
                  <span className="relative inline-flex items-center text-[11px] font-medium text-[#1A1717]/55">
                    <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: selectedHex }} />
                    <select
                      value={newSMMTask.assignee || "smm"}
                      onChange={(e) => {
                        const a = e.target.value;
                        setNewSMMTask({ ...newSMMTask, assignee: a });
                        setDialogColumnName(a === "smm" ? "SMM" : a === "marketer" ? "Marketer" : "Manager");
                      }}
                      className="appearance-none bg-transparent cursor-pointer outline-none border-none pr-3.5 text-[11px] uppercase tracking-wider"
                    >
                      <option value="manager">Manager</option>
                      <option value="smm">SMM</option>
                      <option value="marketer">Marketer</option>
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </span>
                  <span className="relative inline-flex items-center text-[11px] font-medium text-[#1A1717]/55 max-w-[180px]">
                    <span className="mr-1 opacity-50">·</span>
                    <select
                      value={newSMMTask.event_id || ""}
                      onChange={(e) => setNewSMMTask({ ...newSMMTask, event_id: e.target.value })}
                      className="appearance-none bg-transparent cursor-pointer outline-none border-none pr-3.5 text-[11px] uppercase tracking-wider truncate"
                    >
                      <option value="">— без події</option>
                      {[...events]
                        .filter(e => !e.cancelled)
                        .sort((a, b) => new Date(a.date) - new Date(b.date))
                        .map(ev => {
                          const d = new Date(ev.date);
                          return <option key={ev.id} value={ev.id}>{`${d.getDate()} ${UK_MONTHS_NOMINATIVE[d.getMonth()]} — ${ev.title}`}</option>;
                        })}
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </span>
                </div>

                <Input
                  autoFocus
                  placeholder="що треба зробити?"
                  value={newSMMTask.title}
                  onChange={(e) => setNewSMMTask({ ...newSMMTask, title: e.target.value })}
                  onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && newSMMTask.title?.trim()) handleCreateSMMTask(); }}
                  className="w-full h-12 px-4 rounded-xl bg-[#F1EEE7] border-2 border-transparent text-[15px] placeholder:text-[#1A1717]/35 focus:outline-none focus:border-[#1A1717] transition-colors"
                />

                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-hide">
                  {dateChips.map(chip => {
                    const sel = newSMMTask.date === chip.value;
                    return (
                      <button key={chip.value} type="button"
                        onClick={() => setNewSMMTask({ ...newSMMTask, date: chip.value })}
                        className={`shrink-0 h-9 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
                          sel ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 hover:ring-black/25'
                        }`}
                      >{chip.label}</button>
                    );
                  })}
                  <button type="button"
                    onClick={() => setShowSMMCalendar(true)}
                    className={`shrink-0 h-9 px-3.5 rounded-full text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
                      isCustomDate ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 hover:ring-black/25'
                    }`}
                  >
                    <CalendarIcon className="w-3 h-3" />
                    {isCustomDate ? formatDateUkrainian(newSMMTask.date) : 'інша'}
                  </button>
                </div>

                <div className="mt-4 p-3 rounded-2xl bg-[#F1EEE7] ring-1 ring-black/[0.06] flex gap-3">
                  <div className="flex-1 grid grid-cols-7 gap-1.5">
                    {SMM_TASK_ICONS.map(opt => {
                      const sel = newSMMTask.icon === opt.value;
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => setNewSMMTask({ ...newSMMTask, icon: opt.value })}
                          className="aspect-square rounded-xl flex items-center justify-center transition-colors active:scale-95"
                          style={{
                            background: sel ? selectedHex : 'transparent',
                            color: sel ? '#FFFFFF' : '#1A1717',
                            boxShadow: sel ? `0 4px 10px ${selectedHex}40` : 'none',
                          }}
                        ><opt.Icon className="w-4 h-4" /></button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 self-center pl-3 border-l border-black/[0.06]">
                    {PALETTE.map(({c,bg}) => {
                      const sel = newSMMTask.color === c || (c === 'manager' && (!newSMMTask.color || newSMMTask.color === 'standard'));
                      return (
                        <button key={c} type="button"
                          onClick={() => setNewSMMTask({...newSMMTask, color: c})}
                          className="rounded-full transition-colors active:scale-95 flex items-center justify-center"
                          style={{ width: 18, height: 18 }}
                          aria-label={c}
                        >
                          <span className="rounded-full block"
                            style={{
                              width: sel ? 12 : 14, height: sel ? 12 : 14, background: bg,
                              boxShadow: sel ? `0 0 0 2px #FFFFFF, 0 0 0 3.5px ${bg}` : 'none',
                            }} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* (Event picker is now in the header chip-row) */}

                <button
                  onClick={handleCreateSMMTask}
                  disabled={!newSMMTask.title?.trim()}
                  className="mt-4 w-full h-12 rounded-full bg-[#1A1717] text-[#F6F5F1] font-medium text-[14px] transition-colors hover:bg-[#2a2424] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  створити <ChevronRight className="w-4 h-4" />
                </button>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <FullscreenModal isOpen={showSettings} onClose={() => setShowSettings(false)} title="налаштування">
        <SettingsContent />
      </FullscreenModal>

      {/* Analytics Modal - no animation, custom header */}
      {showStats && (
        <div className="fixed inset-0 z-50 bg-[#F6F5F1]">
          <StatsContent onClose={() => setShowStats(false)} settings={settings} />
        </div>
      )}

      <Dialog open={showStandaloneTaskPopup} onOpenChange={setShowStandaloneTaskPopup}>
        <DialogContent className="dialog-content">
          {selectedStandaloneTask && (
            <>
              <button
                type="button"
                className="absolute right-16 top-5 z-[2] w-9 h-9 rounded-full text-red-500 hover:bg-red-50 transition-colors inline-flex items-center justify-center"
                onClick={handleDeleteStandaloneTask}
                title="видалити таск"
                data-testid="task-popup-delete-icon"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <DialogHeader className="pr-24">
                <DialogTitle>{selectedStandaloneTask.title}</DialogTitle>
                <DialogDescription>{formatDateUkrainian(selectedStandaloneTask.date)} — {UK_WEEKDAYS[new Date(selectedStandaloneTask.date).getDay()]}</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3 py-4">
                {(() => { const IconComp = getIconComponent(selectedStandaloneTask.icon || "circle"); return <div className="task-icon"><IconComp /></div>; })()}
                <div>
                  <p className="text-sm font-medium">{selectedStandaloneTask.type === "smm" ? "SMM завдання" : "Завдання"}</p>
                  <p className="text-xs text-secondary">{selectedStandaloneTask.completed ? "виконано" : "не виконано"}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="destructive" onClick={handleDeleteStandaloneTask}><Trash2 className="w-4 h-4 mr-1" />ВИДАЛИТИ</Button>
                <button className="btn-dark" onClick={() => { setEditingStandaloneTask({...selectedStandaloneTask}); setShowStandaloneTaskPopup(false); setShowEditStandaloneDialog(true); }}>РЕДАГУВАТИ</button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog (both standalone and event-based) */}
      <Dialog open={showEditStandaloneDialog} onOpenChange={setShowEditStandaloneDialog}>
        <DialogContent className="sm:max-w-[420px] !p-5 sm:!p-6" onOpenAutoFocus={(e) => e.preventDefault()}>
          {editingStandaloneTask && <TaskHotkeysPanel />}
          {editingStandaloneTask && (() => {
            const getAssigneeName = () => {
              const a = editingStandaloneTask.assignee;
              if (a === 'smm') return 'SMM';
              if (a === 'marketer') return 'Marketer';
              return 'Manager';
            };
            const assigneeName = getAssigneeName();
            const isStandalone = editingStandaloneTask._isStandalone !== false;
            const iconSet = TASK_ICONS;
            const PALETTE = [
              {c:'manager',bg:'#1A1717'}, {c:'red',bg:'#FF8370'}, {c:'purple',bg:'#9333EA'},
              {c:'smm',bg:'#059669'}, {c:'blue',bg:'#3B82F6'}, {c:'orange',bg:'#C4703D'},
              {c:'pink',bg:'#FF8370'}, {c:'teal',bg:'#14B8A6'},
            ];
            const COLOR_MAP = Object.fromEntries(PALETTE.map(p => [p.c, p.bg]));
            const selectedHex = COLOR_MAP[editingStandaloneTask.color] || '#1A1717';
            const today = new Date();
            const dt = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return formatDateLocal(d); };
            const dateChips = [
              { label: "сьогодні", value: dt(0) },
              { label: "завтра",  value: dt(1) },
              { label: "+2д",     value: dt(2) },
              { label: "+3д",     value: dt(3) },
              { label: "+1 тиж",  value: dt(7) },
            ];
            const isCustomDate = !dateChips.some(c => c.value === editingStandaloneTask.date);
            return (
              <>
                {/* Header inline: title + assignee chip + event chip */}
                <div className="flex items-baseline gap-2 mb-4 pr-24 flex-wrap">
                  <DialogTitle className="text-[20px] font-semibold tracking-tight" data-testid="edit-task-title">завдання</DialogTitle>
                  <span className="relative inline-flex items-center text-[11px] font-medium text-[#1A1717]/55">
                    <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: selectedHex }} />
                    <select data-testid="assignee-dropdown" value={editingStandaloneTask.assignee || "manager"}
                      onChange={(e) => setEditingStandaloneTask({...editingStandaloneTask, assignee: e.target.value})}
                      className="appearance-none bg-transparent cursor-pointer outline-none border-none pr-3.5 text-[11px] uppercase tracking-wider"
                    >
                      <option value="manager">Manager</option>
                      <option value="smm">SMM</option>
                      <option value="marketer">Marketer</option>
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </span>
                  {/* Event chip: editable for standalone, read-only label for event-bound */}
                  {isStandalone ? (
                    <span className="relative inline-flex items-center text-[11px] font-medium text-[#1A1717]/55 max-w-[200px]">
                      <span className="mr-1 opacity-50">·</span>
                      <select
                        value={editingStandaloneTask.event_id || ""}
                        onChange={(e) => setEditingStandaloneTask({...editingStandaloneTask, event_id: e.target.value})}
                        className="appearance-none bg-transparent cursor-pointer outline-none border-none pr-3.5 text-[11px] uppercase tracking-wider truncate"
                      >
                        <option value="">— без події</option>
                        {[...events]
                          .filter(e => !e.cancelled)
                          .sort((a, b) => new Date(a.date) - new Date(b.date))
                          .map(ev => {
                            const d = new Date(ev.date);
                            return <option key={ev.id} value={ev.id}>{`${d.getDate()} ${UK_MONTHS_NOMINATIVE[d.getMonth()]} — ${ev.title}`}</option>;
                          })}
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </span>
                  ) : (editingStandaloneTask.eventTitle && (
                    <span className="inline-flex items-center text-[11px] font-medium text-[#1A1717]/55 uppercase tracking-wider max-w-[220px] truncate">
                      <span className="mr-1 opacity-50">·</span>
                      {editingStandaloneTask.eventTitle}
                    </span>
                  ))}
                </div>

                <TaskHotkeysInline />

                <Input
                  placeholder="що треба зробити?"
                  value={editingStandaloneTask.title}
                  onChange={(e) => setEditingStandaloneTask({ ...editingStandaloneTask, title: e.target.value })}
                  className="mt-3 w-full h-12 px-4 rounded-xl bg-[#F1EEE7] border-2 border-transparent text-[15px] placeholder:text-[#1A1717]/35 focus:outline-none focus:border-[#1A1717] transition-colors"
                  data-testid="edit-task-input"
                />

                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  {dateChips.map(chip => {
                    const sel = editingStandaloneTask.date === chip.value;
                    const isSavingThisDate = reschedulingTaskDate === chip.value;
                    return (
                      <button key={chip.value} type="button"
                        onClick={() => handleRescheduleStandaloneTask(chip.value)}
                        disabled={!!reschedulingTaskDate}
                        className={`h-9 rounded-full text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
                          sel ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 hover:ring-black/25'
                        }`}
                        data-testid={`edit-task-date-${chip.label}`}
                      >{isSavingThisDate ? "..." : chip.label}</button>
                    );
                  })}
                </div>

                <div className="mt-2 grid grid-cols-[40px_1fr_40px] gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRescheduleStandaloneTask(shiftDateLocal(editingStandaloneTask.date, -1))}
                    disabled={!!reschedulingTaskDate}
                    className="h-9 rounded-full bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 hover:ring-black/25 transition-colors disabled:opacity-50 inline-flex items-center justify-center"
                    aria-label="перенести на день назад"
                    data-testid="edit-task-date-prev"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className={`h-9 rounded-full bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 inline-flex items-center justify-center gap-2 px-3 ${isCustomDate ? 'ring-black/25' : ''}`}>
                    <button
                      type="button"
                      onClick={() => setShowEditCalendar(true)}
                      className="w-7 h-7 rounded-full hover:bg-black/5 inline-flex items-center justify-center"
                      aria-label="відкрити календар"
                      data-testid="edit-task-date-calendar"
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[12.5px] font-medium tabular-nums">{formatDateUkrainian(editingStandaloneTask.date)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRescheduleStandaloneTask(shiftDateLocal(editingStandaloneTask.date, 1))}
                    disabled={!!reschedulingTaskDate}
                    className="h-9 rounded-full bg-[#F1EEE7] text-[#1A1717] ring-1 ring-black/8 hover:ring-black/25 transition-colors disabled:opacity-50 inline-flex items-center justify-center"
                    aria-label="перенести на день вперед"
                    data-testid="edit-task-date-next"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-4 p-3 rounded-2xl bg-[#F1EEE7] ring-1 ring-black/[0.06] flex gap-3">
                  <div className="flex-1 grid grid-cols-7 gap-1.5">
                    {iconSet.map(opt => {
                      const sel = editingStandaloneTask.icon === opt.value;
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => setEditingStandaloneTask({ ...editingStandaloneTask, icon: opt.value })}
                          className="aspect-square rounded-xl flex items-center justify-center transition-colors active:scale-95"
                          style={{
                            background: sel ? selectedHex : 'transparent',
                            color: sel ? '#FFFFFF' : '#1A1717',
                            boxShadow: sel ? `0 4px 10px ${selectedHex}40` : 'none',
                          }}
                        ><opt.Icon className="w-4 h-4" /></button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 self-center pl-3 border-l border-black/[0.06]">
                    {PALETTE.map(({c,bg}) => {
                      const sel = editingStandaloneTask.color === c || (c === 'manager' && (!editingStandaloneTask.color || editingStandaloneTask.color === 'standard'));
                      return (
                        <button key={c} type="button"
                          onClick={() => setEditingStandaloneTask({...editingStandaloneTask, color: c})}
                          className="rounded-full transition-colors active:scale-95 flex items-center justify-center"
                          style={{ width: 18, height: 18 }}
                          aria-label={c}
                        >
                          <span className="rounded-full block"
                            style={{
                              width: sel ? 12 : 14, height: sel ? 12 : 14, background: bg,
                              boxShadow: sel ? `0 0 0 2px #FFFFFF, 0 0 0 3.5px ${bg}` : 'none',
                            }} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    className="w-12 h-12 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors inline-flex items-center justify-center"
                    data-testid="edit-task-delete-icon"
                    title="видалити таск"
                    aria-label="видалити таск"
                    onClick={handleDeleteEditingTask}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button className="flex-1 h-12 rounded-full bg-[#1A1717] text-[#F6F5F1] font-medium text-[14px] transition-colors hover:bg-[#2a2424] active:scale-[0.98]" data-testid="edit-task-save" onClick={handleSaveStandaloneTask}>зберегти</button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit Calendar for standalone task */}
      <Dialog open={showEditCalendar} onOpenChange={setShowEditCalendar}>
        <DialogContent className="dialog-content">
          <Calendar
            mode="single"
            locale={uk}
            weekStartsOn={1}
            selected={editingStandaloneTask ? new Date(editingStandaloneTask.date) : new Date()}
            onSelect={(d) => {
              if (d && editingStandaloneTask) {
                handleRescheduleStandaloneTask(formatDateLocal(d));
              } else {
                setShowEditCalendar(false);
              }
            }}
            className="w-full"
          />
        </DialogContent>
      </Dialog>

      {/* Day-off creation dialog */}
      <Dialog open={showDayOffDialog} onOpenChange={(o) => { setShowDayOffDialog(o); if (!o) { setDayOffPlan(null); setReviewChoices({}); } }}>
        <DialogContent className="sm:max-w-md">
          {!dayOffPlan ? (
            <>
              <DialogHeader>
                <DialogTitle>додати вихідний</DialogTitle>
                <DialogDescription>система запропонує перерозподіл задач цього дня</DialogDescription>
              </DialogHeader>
              <div className="mt-6 space-y-5">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-[#1A1717]/50 mb-2">хто</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[{v:'manager',l:'Manager'},{v:'smm',l:'SMM'},{v:'marketer',l:'Marketer'}].map(opt => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setDayOffForm({...dayOffForm, assignee: opt.v})}
                        className={`h-11 rounded-full text-sm font-medium transition-colors ${dayOffForm.assignee === opt.v ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-[#F1EEE7] ring-1 ring-black/8 hover:bg-black/5'}`}
                      >{opt.l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-[#1A1717]/50 mb-2">коли</div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="w-full h-12 px-4 rounded-xl bg-[#F1EEE7] border border-black/10 hover:border-[#1A1717]/30 transition-colors flex items-center gap-3 text-left">
                        <CalendarIcon className="w-4 h-4 text-[#1A1717]/60" />
                        <span className="text-sm">{formatDateUkrainian(dayOffForm.date)}</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2 z-[200]" align="start">
                      <Calendar mode="single" locale={uk} weekStartsOn={1}
                        selected={new Date(dayOffForm.date)}
                        onSelect={(d) => { if (d) setDayOffForm({...dayOffForm, date: formatDateLocal(d)}); }}
                        className="calendar-minimal" />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <button
                onClick={async () => {
                  setDayOffSubmitting(true);
                  try {
                    const r = await api.createDayOff(dayOffForm);
                    setDayOffPlan(r.data);
                    // Pre-fill review choices with first suggested date for each chain item
                    const choices = {};
                    (r.data.needs_review || []).forEach(item => {
                      choices[`${item.event_id}::${item.task_id}`] = item.suggested_dates?.[0] || null;
                    });
                    setReviewChoices(choices);
                  } catch { toast.error("помилка створення вихідного"); }
                  finally { setDayOffSubmitting(false); }
                }}
                disabled={dayOffSubmitting}
                className="mt-7 w-full h-12 rounded-full bg-[#1A1717] text-[#F6F5F1] font-medium text-sm hover:bg-[#333333] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                {dayOffSubmitting ? "рахуємо..." : "далі — побачити перерозподіл"}
              </button>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>перерозподіл задач</DialogTitle>
                <DialogDescription>
                  вихідний {formatDateUkrainian(dayOffPlan.day_off.date)} • {dayOffPlan.day_off.assignee === "manager" ? "Manager" : dayOffPlan.day_off.assignee === "smm" ? "SMM" : "Marketer"}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-5 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {/* Auto-shifts (collapsed) */}
                {dayOffPlan.auto_shifts && dayOffPlan.auto_shifts.length > 0 && (
                  <details className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-emerald-900 select-none">
                      ✓ автоматично перенесено {dayOffPlan.auto_shifts.length} {dayOffPlan.auto_shifts.length === 1 ? "задачу" : "задач"}
                    </summary>
                    <div className="mt-3 space-y-1.5">
                      {dayOffPlan.auto_shifts.map(s => (
                        <div key={`${s.event_id}::${s.task_id}`} className="text-xs text-emerald-900/80 flex items-center gap-2">
                          <span>•</span>
                          <span className="flex-1 truncate"><b>{s.name}</b> — {s.event_title}</span>
                          <span className="tabular-nums opacity-70">→ {formatDateUkrainian(s.new_date)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {/* Needs review (expanded, highlighted) */}
                {dayOffPlan.needs_review && dayOffPlan.needs_review.length > 0 && (
                  <div className="rounded-xl bg-amber-50 ring-1 ring-amber-300 p-4">
                    <div className="text-sm font-semibold text-amber-900 mb-3">⚠ потребують твого рішення ({dayOffPlan.needs_review.length})</div>
                    <div className="space-y-3">
                      {dayOffPlan.needs_review.map(item => {
                        const key = `${item.event_id}::${item.task_id}`;
                        const choice = reviewChoices[key];
                        return (
                          <div key={key} className="p-3 rounded-lg bg-[#F1EEE7]">
                            <div className="text-sm font-medium">{item.name}</div>
                            <div className="text-xs text-secondary mt-0.5">{item.event_title}</div>
                            <div className="text-xs text-amber-900/80 mt-1.5 italic">{item.reason}</div>
                            {item.kind === "fixed" ? (
                              <div className="mt-2 text-xs text-secondary">залишається на {formatDateUkrainian(item.original_date)} — делегувати або зробити вручну.</div>
                            ) : (
                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                {item.suggested_dates.map(d => (
                                  <button key={d} type="button"
                                    onClick={() => setReviewChoices({...reviewChoices, [key]: d})}
                                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${choice === d ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-black/5 hover:bg-black/10'}`}
                                  >{formatDateUkrainian(d)}</button>
                                ))}
                                <button type="button"
                                  onClick={() => setReviewChoices({...reviewChoices, [key]: null})}
                                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${choice === null ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-black/5 hover:bg-black/10'}`}
                                >не зміщати</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(!dayOffPlan.auto_shifts || dayOffPlan.auto_shifts.length === 0) &&
                 (!dayOffPlan.needs_review || dayOffPlan.needs_review.length === 0) && (
                  <div className="text-sm text-secondary text-center py-6">на цей день не було активних задач — зміщувати нічого</div>
                )}
              </div>
              <button
                onClick={async () => {
                  setDayOffSubmitting(true);
                  try {
                    const shifts = [
                      ...((dayOffPlan.auto_shifts || []).map(s => ({event_id: s.event_id, task_id: s.task_id, new_date: s.new_date, column: s.column}))),
                      ...((dayOffPlan.needs_review || [])
                        .filter(item => item.kind !== "fixed")
                        .map(item => {
                          const key = `${item.event_id}::${item.task_id}`;
                          const chosen = reviewChoices[key];
                          if (!chosen) return null;
                          return {event_id: item.event_id, task_id: item.task_id, new_date: chosen, column: item.column};
                        }).filter(Boolean)),
                    ];
                    const r = await api.applyDayOffShifts(dayOffPlan.day_off.id, {shifts});
                    toast.success(`перенесено ${r.data.count} задач`);
                    setShowDayOffDialog(false);
                    setDayOffPlan(null);
                    setReviewChoices({});
                    refreshEvents();
                  } catch { toast.error("помилка"); }
                  finally { setDayOffSubmitting(false); }
                }}
                disabled={dayOffSubmitting}
                className="mt-6 w-full h-12 rounded-full bg-[#1A1717] text-[#F6F5F1] font-medium text-sm hover:bg-[#333333] disabled:opacity-50 transition-colors"
              >
                {dayOffSubmitting ? "застосовуємо..." : "застосувати перерозподіл"}
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel-series choice dialog (regular events only) */}
      <AlertDialog open={!!cancelSeriesDialogFor} onOpenChange={(open) => { if (!open) setCancelSeriesDialogFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>скасувати регулярну подію</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelSeriesDialogFor?.title
                ? <>«{cancelSeriesDialogFor.title}» — частина регулярної серії. що скасовуємо?</>
                : "ця подія — частина регулярної серії. що скасовуємо?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-series-keep-all">залишити все</AlertDialogCancel>
            <AlertDialogAction
              variant="warning"
              onClick={cancelSeriesOnlyThis}
              data-testid="cancel-series-only-this"
            >
              тільки цю
            </AlertDialogAction>
            <AlertDialogAction
              variant="danger"
              onClick={cancelSeriesAllFuture}
              data-testid="cancel-series-all-future"
            >
              цю + всі наступні
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OverlapResolverDialog
        task={overlapResolverTask}
        open={!!overlapResolverTask}
        onClose={() => setOverlapResolverTask(null)}
        onResolved={() => {
          refreshEvents();
          refreshStandaloneTasks();
          // Refresh overlap map so the badge disappears immediately if resolved
          axios.get(`${API}/smm/announcement-overlaps`).then(r => setAnnouncementOverlaps(r.data || {})).catch(() => {});
        }}
      />
    </div>
  );
};

// Settings Content for modals - with 4 columns layout
const SettingsContent = () => {
  const { settings, refreshSettings, refreshSMMTasksDefinition, refreshEvents, allTaskDefs, googleCalendarStatus, refreshGoogleStatus } = useApp();
  const [exportingAll, setExportingAll] = useState(false);
  const [altegioConnected, setAltegioConnected] = useState(false);

  useEffect(() => {
    axios.get(`${API}/altegio/status`).then(r => setAltegioConnected(r.data?.connected || false)).catch(() => {});
  }, []);

  const handleGoogleConnect = async () => {
    try { const response = await axios.get(`${API}/oauth/calendar/login`); window.location.href = response.data.authorization_url; }
    catch { toast.error("помилка підключення"); }
  };
  const handleGoogleDisconnect = async () => {
    try { await axios.post(`${API}/oauth/calendar/disconnect`); refreshGoogleStatus(); toast.success("Google Calendar відключено"); }
    catch { toast.error("помилка"); }
  };
  const handleExportAllEvents = async () => {
    setExportingAll(true);
    try { const response = await axios.post(`${API}/calendar/export-all`); response.data.exported_count > 0 ? toast.success(`Експортовано ${response.data.exported_count} подій`) : toast.info("Немає нових подій для експорту"); }
    catch { toast.error("Помилка експорту"); }
    finally { setExportingAll(false); }
  };

  const [editTask, setEditTask] = useState(null); // full draft of task being edited
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [newTaskDraft, setNewTaskDraft] = useState({ name: "", days_before: 7, column: "management", is_announcement: false, is_teamwork: false, series_master_only: false });

  const handleSaveTask = async () => {
    if (!editTask?.name?.trim()) return;
    try {
      const freq = editTask.frequency || "event";
      const payload = {
        name: editTask.name,
        days_before: parseInt(editTask.days_before) || 0,
        column: editTask.column,
        frequency: freq,
        is_teamwork: !!editTask.is_teamwork,
      };
      if (freq === "event") {
        payload.is_announcement = !!editTask.is_announcement;
        payload.series_master_only = !!editTask.series_master_only;
        payload.condition = editTask.condition || null;
      }
      await api.editTaskDef(editTask.id, payload);
      toast.success("збережено!");
      refreshSMMTasksDefinition();
      refreshEvents();
      setEditTask(null);
    } catch { toast.error("помилка"); }
  };

  const handleDeleteTask = async () => {
    if (!editTask) return;
    try {
      await api.deleteTaskDef(editTask.id);
      toast.success("видалено!");
      refreshSMMTasksDefinition();
      refreshEvents();
      setEditTask(null);
    } catch { toast.error("помилка"); }
  };

  const handleAddTask = async () => {
    if (!newTaskDraft?.name?.trim()) return;
    try {
      const freq = newTaskDraft.frequency || "event";
      const payload = {
        name: newTaskDraft.name,
        days_before: parseInt(newTaskDraft.days_before) || 0,
        column: newTaskDraft.column,
        frequency: freq,
        is_teamwork: !!newTaskDraft.is_teamwork,
      };
      if (freq === "event") {
        payload.is_announcement = !!newTaskDraft.is_announcement;
        payload.series_master_only = !!newTaskDraft.series_master_only;
        payload.condition = newTaskDraft.condition || null;
      }
      await api.createTaskDef(payload);
      toast.success("додано!");
      refreshSMMTasksDefinition();
      refreshEvents();
      setShowAddTaskDialog(false);
      setNewTaskDraft({ name: "", days_before: 7, column: "management", frequency: "event", is_announcement: false, is_teamwork: false, series_master_only: false, condition: null });
    } catch { toast.error("помилка"); }
  };

  const allTasks = useMemo(() => {
    const mgmt = (allTaskDefs.management || []).map(t => ({ ...t, _col: 'менеджмент' }));
    const smm = (allTaskDefs.smm || []).map(t => ({ ...t, _col: 'smm' }));
    const mktg = (allTaskDefs.marketing || []).map(t => ({ ...t, _col: 'маркетинг' }));
    const monthly = (allTaskDefs.monthly || []).map(t => ({ ...t, _col: 'щомісяця', _colTarget: t.column === 'smm' ? 'smm' : t.column === 'marketing' ? 'маркетинг' : 'менеджмент' }));
    const daily = (allTaskDefs.daily || []).map(t => ({ ...t, _col: 'щоденно' }));
    // Split monthly by target column
    const monthlyMgmt = monthly.filter(t => t._colTarget === 'менеджмент');
    const monthlySMM = monthly.filter(t => t._colTarget === 'smm');
    const monthlyMktg = monthly.filter(t => t._colTarget === 'маркетинг');
    // Split daily by column
    const dailyMgmt = daily.filter(t => t.column === 'management');
    const dailySMM = daily.filter(t => t.column === 'smm');
    const dailyMktg = daily.filter(t => t.column === 'marketing');
    return { mgmt, smm, mktg, monthly, daily, monthlyMgmt, monthlySMM, monthlyMktg, dailyMgmt, dailySMM, dailyMktg };
  }, [allTaskDefs]);

  const TaskRow = ({ task }) => {
    const IconComponent = getIconComponent(task.icon || SMM_ICONS[task.id] || "circle");
    const badges = [];
    if (task.is_teamwork) badges.push("тімворк");
    if (task.is_announcement) badges.push("анонс");
    if (task.condition) badges.push(task.condition.type === "booking_below" ? `<${task.condition.threshold}%` : `>${task.condition.threshold}%`);
    if (task._colTarget && task._col !== 'щомісяця') badges.push(task._colTarget);
    return (
      <div className="reminder-item cursor-pointer hover:bg-black/3 transition-colors" data-testid={`settings-task-${task.id}`} onClick={() => setEditTask({
        ...task,
        column: task.column || (task._col === 'smm' ? 'smm' : task._col === 'маркетинг' ? 'marketing' : 'management'),
      })}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="task-icon"><IconComponent /></div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{task.name}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-secondary">за {task.days_before} дн.</span>
              {badges.map((b, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/5 text-secondary">{b}</span>)}
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-secondary" />
      </div>
    );
  };

  return (
    <>
    <div className="desktop-columns-4" data-testid="settings-list">
      {/* Column 1: Automation */}
      <div className="desktop-column">
        <div className="px-4 py-3">
          <span className="text-sm font-semibold tracking-wide">ІНШЕ</span>
        </div>
        <div className="column-content space-y-4">
          <div>
            <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">автоматизація</p>
            <div className="space-y-1">
              <div className="reminder-item !py-2">
                <div className="flex items-center gap-3">
                  <div className="task-icon"><CalendarIcon /></div>
                  <div><p className="font-medium text-sm">Google Calendar</p><p className="text-xs text-secondary">{googleCalendarStatus.connected ? (googleCalendarStatus.email || "підключено") : "не підключено"}</p></div>
                </div>
                {!googleCalendarStatus.connected ? (
                  <button className="btn-dark text-xs px-2 py-1" onClick={handleGoogleConnect}>підключити</button>
                ) : (
                  <button className="text-red-500 text-xs" onClick={handleGoogleDisconnect}>відключити</button>
                )}
              </div>
              {googleCalendarStatus.connected && (
                <button className="btn-subtle w-full text-xs !h-7" onClick={handleExportAllEvents} disabled={exportingAll}>
                  <ExternalLink className="w-3.5 h-3.5" /><span>{exportingAll ? "експортую..." : "експортувати всі"}</span>
                </button>
              )}
              <div className="reminder-item !py-2 border-t border-[#E8E5DC]">
                <div className="flex items-center gap-3">
                  <div className="task-icon"><ExternalLink /></div>
                  <div><p className="font-medium text-sm">Altegio</p><p className="text-xs text-secondary">{altegioConnected ? "підключено" : "не підключено"}</p></div>
                </div>
                <span className={`text-xs ${altegioConnected ? 'text-green-600' : 'text-secondary'}`}>{altegioConnected ? "активний" : "—"}</span>
              </div>
              <div className="pt-2 border-t border-[#E8E5DC]">
                <TelegramSettingsSection compact />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Column 2: MANAGER + daily + monthly */}
      <div className="desktop-column">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold tracking-wide">MANAGER</span>
            <span className="text-xs text-secondary ml-2">({allTasks.mgmt.length})</span>
          </div>
          <button className="add-btn" title="новий таск" onClick={() => { setNewTaskDraft({ name: "", days_before: 7, column: "management", is_announcement: false, is_teamwork: false, series_master_only: false }); setShowAddTaskDialog(true); }}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="column-content space-y-4">
          {allTasks.dailyMgmt.length > 0 && (
            <div>
              <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">щоденно</p>
              <div className="space-y-0.5">{allTasks.dailyMgmt.map(t => <TaskRow key={t.id} task={t} />)}</div>
            </div>
          )}
          <div>
            <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">на подію</p>
            <div className="space-y-0.5">{allTasks.mgmt.sort((a, b) => b.days_before - a.days_before).map(t => <TaskRow key={t.id} task={t} />)}</div>
          </div>
          {allTasks.monthlyMgmt.length > 0 && (
            <div>
              <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">щомісяця ({allTasks.monthlyMgmt.length})</p>
              <div className="space-y-0.5">{allTasks.monthlyMgmt.sort((a, b) => b.days_before - a.days_before).map(t => <TaskRow key={t.id} task={t} />)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Column 3: SMM + daily + monthly */}
      <div className="desktop-column">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold tracking-wide">SMM</span>
            <span className="text-xs text-secondary ml-2">({allTasks.smm.length})</span>
          </div>
          <button className="add-btn" title="новий таск" onClick={() => { setNewTaskDraft({ name: "", days_before: 7, column: "smm", is_announcement: false, is_teamwork: false, series_master_only: false }); setShowAddTaskDialog(true); }}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="column-content space-y-4">
          {allTasks.dailySMM.length > 0 && (
            <div>
              <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">щоденно</p>
              <div className="space-y-0.5">{allTasks.dailySMM.map(t => <TaskRow key={t.id} task={t} />)}</div>
            </div>
          )}
          <div>
            <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">на подію</p>
            <div className="space-y-0.5">{allTasks.smm.sort((a, b) => b.days_before - a.days_before).map(t => <TaskRow key={t.id} task={t} />)}</div>
          </div>
          {allTasks.monthlySMM.length > 0 && (
            <div>
              <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">щомісяця ({allTasks.monthlySMM.length})</p>
              <div className="space-y-0.5">{allTasks.monthlySMM.sort((a, b) => b.days_before - a.days_before).map(t => <TaskRow key={t.id} task={t} />)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Column 4: MARKETER + daily + monthly */}
      <div className="desktop-column">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold tracking-wide">MARKETER</span>
            <span className="text-xs text-secondary ml-2">({allTasks.mktg.length})</span>
          </div>
          <button className="add-btn" title="новий таск" onClick={() => { setNewTaskDraft({ name: "", days_before: 7, column: "marketing", is_announcement: false, is_teamwork: false, series_master_only: false }); setShowAddTaskDialog(true); }}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="column-content space-y-4">
          {allTasks.dailyMktg.length > 0 && (
            <div>
              <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">щоденно</p>
              <div className="space-y-0.5">{allTasks.dailyMktg.map(t => <TaskRow key={t.id} task={t} />)}</div>
            </div>
          )}
          <div>
            <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">на подію</p>
            <div className="space-y-0.5">{allTasks.mktg.sort((a, b) => b.days_before - a.days_before).map(t => <TaskRow key={t.id} task={t} />)}</div>
            {allTasks.mktg.length === 0 && <p className="text-secondary text-center py-4 text-sm">немає завдань</p>}
          </div>
          {allTasks.monthlyMktg.length > 0 && (
            <div>
              <p className="text-xs text-secondary font-medium mb-2 uppercase tracking-wider">щомісяця ({allTasks.monthlyMktg.length})</p>
              <div className="space-y-0.5">{allTasks.monthlyMktg.sort((a, b) => b.days_before - a.days_before).map(t => <TaskRow key={t.id} task={t} />)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
    {editTask && (
      <Dialog open={!!editTask} onOpenChange={() => setEditTask(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>редагувати таск</DialogTitle>
            <DialogDescription>зміни записуються в історію — можна відкотити</DialogDescription>
          </DialogHeader>
          <TaskDefEditor draft={editTask} setDraft={setEditTask} />
          <DialogFooter className="mt-6 flex gap-2">
            <button className="flex-1 h-11 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5 text-sm font-medium" onClick={handleDeleteTask}>
              <Trash2 className="w-4 h-4" />видалити
            </button>
            <button className="btn-dark flex-1 h-11" onClick={handleSaveTask}>зберегти</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}

    <Dialog open={showAddTaskDialog} onOpenChange={setShowAddTaskDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>новий таск</DialogTitle>
          <DialogDescription>система буде створювати його автоматично для кожної події</DialogDescription>
        </DialogHeader>
        <TaskDefEditor draft={newTaskDraft} setDraft={setNewTaskDraft} />
        <DialogFooter className="mt-6">
          <button className="btn-dark w-full h-11" onClick={handleAddTask}>створити</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
const StatsContent = ({ onClose, settings }) => {
  const { events, standaloneTasks, smmTasksDefinition, refreshEvents } = useApp();
  const [periodType, setPeriodType] = useState('week'); // 'week' or 'month'
  const [currentPeriod, setCurrentPeriod] = useState(new Date());
  const [selectedTask, setSelectedTask] = useState(null);

  // ESC key handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // SMM task name lookup
  const getSMMTaskName = (taskId) => {
    const task = smmTasksDefinition?.find(t => t.id === taskId);
    return task?.name || taskId;
  };

  // Get week boundaries
  const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const getWeekEnd = (date) => {
    const start = getWeekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  };

  // Get month boundaries
  const getMonthStart = (date) => {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const getMonthEnd = (date) => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setHours(23, 59, 59, 999);
    return d;
  };

  // Navigate periods
  const goToPrevPeriod = () => {
    const newDate = new Date(currentPeriod);
    if (periodType === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentPeriod(newDate);
  };

  const goToNextPeriod = () => {
    const newDate = new Date(currentPeriod);
    if (periodType === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentPeriod(newDate);
  };

  // Format period label
  const getPeriodLabel = () => {
    if (periodType === 'week') {
      const start = getWeekStart(currentPeriod);
      const end = getWeekEnd(currentPeriod);
      const startDay = start.getDate();
      const endDay = end.getDate();
      const startMonth = UK_MONTHS_SHORT[start.getMonth()];
      const endMonth = UK_MONTHS_SHORT[end.getMonth()];
      if (start.getMonth() === end.getMonth()) {
        return `${startDay}—${endDay} ${startMonth}`;
      }
      return `${startDay} ${startMonth} — ${endDay} ${endMonth}`;
    } else {
      return `${UK_MONTHS[currentPeriod.getMonth()]} ${currentPeriod.getFullYear()}`;
    }
  };

  // Get period boundaries
  const periodStart = periodType === 'week' ? getWeekStart(currentPeriod) : getMonthStart(currentPeriod);
  const periodEnd = periodType === 'week' ? getWeekEnd(currentPeriod) : getMonthEnd(currentPeriod);

  // Get completed tasks with full info - split into on-time and late
  const getCompletedOnTime = (color) => {
    const results = [];

    events.forEach(event => {
      if (!event.completed_smm_tasks) return;
      Object.entries(event.completed_smm_tasks).forEach(([taskId, completedAt]) => {
        if (!completedAt) return;
        const taskDate = event.smm_tasks?.[taskId];
        if (!taskDate) return;
        const date = new Date(taskDate);
        if (date >= periodStart && date <= periodEnd) {
          const taskDef = smmTasksDefinition?.find(t => t.id === taskId);
          const taskColor = taskDef?.color || 'standard';
          const isSMMTask = taskColor === 'smm';
          const isMatch = (color === 'smm' && isSMMTask) ||
                          (color === 'marketer' && !isSMMTask);
          if (isMatch) {
            const completedDate = new Date(typeof completedAt === 'string' ? completedAt : taskDate);
            const dueDate = new Date(taskDate);
            dueDate.setHours(23, 59, 59, 999);
            const isLate = completedDate > dueDate;
            if (!isLate) {
              results.push({
                id: `${event.id}-${taskId}`, taskId, eventId: event.id,
                date: taskDate, completedAt: typeof completedAt === 'string' ? completedAt : taskDate,
                name: getSMMTaskName(taskId), event: event.title, type: 'smm', color: taskColor
              });
            }
          }
        }
      });
    });

    standaloneTasks.filter(t => t.completed).forEach(task => {
      const date = new Date(task.date);
      if (date >= periodStart && date <= periodEnd) {
        const taskColor = task.color || 'standard';
        const isSMMTask = taskColor === 'smm';
        const isMatch = (color === 'smm' && isSMMTask) ||
                        (color === 'marketer' && !isSMMTask && task.type === 'smm');
        if (isMatch) {
          const completedDate = new Date(task.completed_at || task.date);
          const dueDate = new Date(task.date);
          dueDate.setHours(23, 59, 59, 999);
          const isLate = completedDate > dueDate;
          if (!isLate) {
            results.push({
              id: task.id, date: task.date, completedAt: task.completed_at || task.date,
              name: task.title, event: task.title, type: 'standalone', color: taskColor
            });
          }
        }
      }
    });

    return results;
  };

  const getCompletedLate = (color) => {
    const results = [];

    events.forEach(event => {
      if (!event.completed_smm_tasks) return;
      Object.entries(event.completed_smm_tasks).forEach(([taskId, completedAt]) => {
        if (!completedAt) return;
        const taskDate = event.smm_tasks?.[taskId];
        if (!taskDate) return;
        const date = new Date(taskDate);
        if (date >= periodStart && date <= periodEnd) {
          const taskDef = smmTasksDefinition?.find(t => t.id === taskId);
          const taskColor = taskDef?.color || 'standard';
          const isSMMTask = taskColor === 'smm';
          const isMatch = (color === 'smm' && isSMMTask) ||
                          (color === 'marketer' && !isSMMTask);
          if (isMatch) {
            const completedDate = new Date(typeof completedAt === 'string' ? completedAt : taskDate);
            const dueDate = new Date(taskDate);
            dueDate.setHours(23, 59, 59, 999);
            const isLate = completedDate > dueDate;
            if (isLate) {
              results.push({
                id: `${event.id}-${taskId}`, taskId, eventId: event.id,
                date: taskDate, completedAt: typeof completedAt === 'string' ? completedAt : taskDate,
                name: getSMMTaskName(taskId), event: event.title, type: 'smm', color: taskColor
              });
            }
          }
        }
      });
    });

    standaloneTasks.filter(t => t.completed).forEach(task => {
      const date = new Date(task.date);
      if (date >= periodStart && date <= periodEnd) {
        const taskColor = task.color || 'standard';
        const isSMMTask = taskColor === 'smm';
        const isMatch = (color === 'smm' && isSMMTask) ||
                        (color === 'marketer' && !isSMMTask && task.type === 'smm');
        if (isMatch) {
          const completedDate = new Date(task.completed_at || task.date);
          const dueDate = new Date(task.date);
          dueDate.setHours(23, 59, 59, 999);
          const isLate = completedDate > dueDate;
          if (isLate) {
            results.push({
              id: task.id, date: task.date, completedAt: task.completed_at || task.date,
              name: task.title, event: task.title, type: 'standalone', color: taskColor
            });
          }
        }
      }
    });

    return results;
  };

  // Get uncompleted tasks
  const getUncompleted = (color) => {
    const uncompleted = [];
    const today = new Date();

    events.forEach(event => {
      if (event.cancelled) return;
      Object.entries(event.smm_tasks || {}).forEach(([taskId, taskDate]) => {
        const date = new Date(taskDate);
        if (date >= periodStart && date <= periodEnd && date < today) {
          const isCompleted = event.completed_smm_tasks?.[taskId];
          if (!isCompleted) {
            const taskDef = smmTasksDefinition?.find(t => t.id === taskId);
            const taskColor = taskDef?.color || 'standard';
            const isSMMTask = taskColor === 'smm';
            const isMatch = (color === 'smm' && isSMMTask) ||
                            (color === 'marketer' && !isSMMTask);
            if (isMatch) {
              uncompleted.push({
                id: `${event.id}-${taskId}`,
                taskId,
                eventId: event.id,
                date: taskDate,
                name: getSMMTaskName(taskId),
                event: event.title,
                type: 'smm',
                color: taskColor
              });
            }
          }
        }
      });
    });

    return uncompleted;
  };

  // Get MANAGER tasks from event reminders
  const getManagerOnTime = () => {
    const results = [];
    events.forEach(event => {
      if (event.cancelled) return;
      Object.entries(event.reminders || {}).forEach(([reminderId, reminderDate]) => {
        const date = new Date(reminderDate);
        if (date >= periodStart && date <= periodEnd) {
          const isCompleted = event.completed_tasks?.[reminderId];
          if (isCompleted) {
            const completedDate = new Date(typeof isCompleted === 'string' ? isCompleted : reminderDate);
            const dueDate = new Date(reminderDate);
            dueDate.setHours(23, 59, 59, 999);
            if (completedDate <= dueDate) {
              const rt = settings?.reminder_types?.find(r => r.id === reminderId);
              results.push({ id: `${event.id}-${reminderId}`, date: reminderDate, completedAt: typeof isCompleted === 'string' ? isCompleted : reminderDate, name: rt?.name || reminderId, event: event.title, type: 'reminder' });
            }
          }
        }
      });
    });
    standaloneTasks.filter(t => t.completed && t.type === 'regular').forEach(task => {
      const date = new Date(task.date);
      if (date >= periodStart && date <= periodEnd) {
        const completedDate = new Date(task.completed_at || task.date);
        const dueDate = new Date(task.date); dueDate.setHours(23, 59, 59, 999);
        if (completedDate <= dueDate) {
          results.push({ id: task.id, date: task.date, completedAt: task.completed_at || task.date, name: task.title, event: task.title, type: 'standalone' });
        }
      }
    });
    return results;
  };

  const getManagerLate = () => {
    const results = [];
    events.forEach(event => {
      if (event.cancelled) return;
      Object.entries(event.reminders || {}).forEach(([reminderId, reminderDate]) => {
        const date = new Date(reminderDate);
        if (date >= periodStart && date <= periodEnd) {
          const isCompleted = event.completed_tasks?.[reminderId];
          if (isCompleted) {
            const completedDate = new Date(typeof isCompleted === 'string' ? isCompleted : reminderDate);
            const dueDate = new Date(reminderDate);
            dueDate.setHours(23, 59, 59, 999);
            if (completedDate > dueDate) {
              const rt = settings?.reminder_types?.find(r => r.id === reminderId);
              results.push({ id: `${event.id}-${reminderId}`, date: reminderDate, completedAt: typeof isCompleted === 'string' ? isCompleted : reminderDate, name: rt?.name || reminderId, event: event.title, type: 'reminder' });
            }
          }
        }
      });
    });
    standaloneTasks.filter(t => t.completed && t.type === 'regular').forEach(task => {
      const date = new Date(task.date);
      if (date >= periodStart && date <= periodEnd) {
        const completedDate = new Date(task.completed_at || task.date);
        const dueDate = new Date(task.date); dueDate.setHours(23, 59, 59, 999);
        if (completedDate > dueDate) {
          results.push({ id: task.id, date: task.date, completedAt: task.completed_at || task.date, name: task.title, event: task.title, type: 'standalone' });
        }
      }
    });
    return results;
  };

  const getManagerUncompleted = () => {
    const uncompleted = [];
    const today = new Date();
    events.forEach(event => {
      if (event.cancelled) return;
      Object.entries(event.reminders || {}).forEach(([reminderId, reminderDate]) => {
        const date = new Date(reminderDate);
        if (date >= periodStart && date <= periodEnd && date < today) {
          const isCompleted = event.completed_tasks?.[reminderId];
          if (!isCompleted) {
            const rt = settings?.reminder_types?.find(r => r.id === reminderId);
            uncompleted.push({ id: `${event.id}-${reminderId}`, date: reminderDate, name: rt?.name || reminderId, event: event.title, type: 'reminder' });
          }
        }
      });
    });
    return uncompleted;
  };
  const handleRestoreTask = async (task) => {
    try {
      if (task.type === 'smm') {
        await api.completeSMMTask({ event_id: task.eventId, task_id: task.taskId, completed: false });
      } else if (task.type === 'standalone') {
        await api.updateStandaloneTask(task.id, false);
      }
      refreshEvents();
      toast.success("відновлено");
      setSelectedTask(null);
    } catch {
      toast.error("помилка");
    }
  };

  // Get events in period - all (not just non-cancelled)
  const getEventsInPeriod = () => {
    return events.filter(event => {
      const date = new Date(event.date);
      return date >= periodStart && date <= periodEnd && !event.cancelled;
    });
  };

  const getCancelledEventsInPeriod = () => {
    return events.filter(event => {
      const date = new Date(event.date);
      return date >= periodStart && date <= periodEnd && event.cancelled;
    });
  };

  const periodEvents = getEventsInPeriod();
  const cancelledEvents = getCancelledEventsInPeriod();
  const plannedRevenue = periodEvents.reduce((sum, e) => sum + (parseFloat(e.price) || 0) * (parseInt(e.spots) || 10), 0);
  const realRevenue = periodEvents.reduce((sum, e) => {
    const booked = e.altegio_booked_count != null ? e.altegio_booked_count : (parseInt(e.spots) || 10);
    return sum + (parseFloat(e.price) || 0) * booked;
  }, 0);

  const smmOnTime = getCompletedOnTime('smm');
  const smmLate = getCompletedLate('smm');
  const smmUncompleted = getUncompleted('smm');
  const managerOnTime = getManagerOnTime();
  const managerLate = getManagerLate();
  const managerUncompleted = getManagerUncompleted();
  const marketerOnTime = getCompletedOnTime('marketer');
  const marketerLate = getCompletedLate('marketer');
  const marketerUncompleted = getUncompleted('marketer');

  const renderStatsColumn = (title, onTime, late, uncompleted) => {
    const total = onTime.length + late.length + uncompleted.length;
    const allOnTime = total > 0 && late.length === 0 && uncompleted.length === 0;
    return (
    <div className="desktop-column">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-wide">{title}</span>
          {allOnTime && <span className="text-base" title="всі вчасно">🏆</span>}
        </div>
        <span className="text-xs text-secondary">{total} тасків</span>
      </div>
      <div className="column-content">
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-emerald-600">{onTime.length}</p>
              <p className="text-xs text-secondary">збс</p>
            </div>
            <div>
              <p className="text-lg font-bold text-orange-500">{late.length}</p>
              <p className="text-xs text-secondary">опіздали</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-500">{uncompleted.length}</p>
              <p className="text-xs text-secondary">пупупу</p>
            </div>
          </div>
        </div>

        {onTime.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-emerald-600 mb-2">збс</p>
            <div className="space-y-1">
              {onTime.map((task) => (
                <div key={task.id} className="flex items-center gap-2 py-2 px-2 bg-emerald-50 rounded cursor-pointer hover:bg-emerald-100 transition-colors" onClick={() => setSelectedTask(task)}>
                  <div className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3 text-[#F6F5F1]" /></div>
                  <span className="flex-1 text-sm truncate text-emerald-800">{task.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {late.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-orange-500 mb-2">опіздали</p>
            <div className="space-y-1">
              {late.map((task) => (
                <div key={task.id} className="flex items-center gap-2 py-2 px-2 bg-orange-50 rounded cursor-pointer hover:bg-orange-100 transition-colors" onClick={() => setSelectedTask(task)}>
                  <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3 text-[#F6F5F1]" /></div>
                  <span className="flex-1 text-sm truncate text-orange-800">{task.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {uncompleted.length > 0 && (
          <div>
            <p className="text-xs font-medium text-red-500 mb-2">пупупу</p>
            <div className="space-y-1">
              {uncompleted.map((task) => (
                <div key={task.id} className="flex items-center gap-2 py-2 px-2 bg-red-50 rounded cursor-pointer hover:bg-red-100 transition-colors" onClick={() => setSelectedTask(task)}>
                  <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0"><X className="w-3 h-3 text-[#F6F5F1]" /></div>
                  <span className="flex-1 text-sm truncate text-red-800">{task.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {total === 0 && (
          <p className="text-secondary text-sm text-center py-4">немає даних</p>
        )}
      </div>
    </div>
  )};

  return (
    <div className="desktop-dashboard">
      <header className="desktop-header" style={{position: 'relative'}}>
        <div className="desktop-header-left">
          <span className="text-xl font-semibold">аналітика</span>
        </div>
        <div style={{position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)'}} className="flex items-center gap-3">
          <button
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${periodType === 'week' ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-black/5 text-[#1A1717] hover:bg-black/10'}`}
            onClick={() => setPeriodType('week')}
          >
            ТИЖДЕНЬ
          </button>
          <button
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${periodType === 'month' ? 'bg-[#1A1717] text-[#F6F5F1]' : 'bg-black/5 text-[#1A1717] hover:bg-black/10'}`}
            onClick={() => setPeriodType('month')}
          >
            МІСЯЦЬ
          </button>
          <div className="flex items-center gap-1 ml-1">
            <button onClick={goToPrevPeriod} className="p-1.5 hover:bg-black/5 rounded-full transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium min-w-[110px] text-center">{getPeriodLabel()}</span>
            <button onClick={goToNextPeriod} className="p-1.5 hover:bg-black/5 rounded-full transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="desktop-header-right cursor-pointer" onClick={onClose} style={{marginRight: '-24px', paddingRight: '24px'}} data-testid="analytics-close-area">
          <div className="desktop-header-btn relative">
            <X className="w-5 h-5" />
            <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-xs text-secondary flex items-center gap-1 whitespace-nowrap pointer-events-none font-normal">або <kbd className="px-1.5 py-0.5 bg-[rgba(243,238,226,0.1)] rounded text-[10px] font-mono border border-[rgba(243,238,226,0.16)]">ESC</kbd> щоб закрити</span>
          </div>
          <div className="desktop-header-btn opacity-0 pointer-events-none"><FileText className="w-5 h-5" /></div>
          <div className="btn-dark opacity-0 pointer-events-none"><Plus className="w-4 h-4" /><span>подія</span></div>
          <div className="desktop-header-btn opacity-0 pointer-events-none"><Settings className="w-5 h-5" /></div>
        </div>
      </header>
      <div className="desktop-columns-4">
        {/* ПОДІЇ */}
        <div className="desktop-column">
          <div className="px-4 py-3">
            <span className="text-sm font-semibold tracking-wide">ПОДІЇ</span>
          </div>
          <div className="column-content">
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold">{periodEvents.length + cancelledEvents.length}</p>
                    <p className="text-xs text-secondary">заплановано</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">{periodEvents.length}</p>
                    <p className="text-xs text-secondary">відбулося</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-red-500">{cancelledEvents.length}</p>
                    <p className="text-xs text-secondary">скасовано</p>
                  </div>
                </div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-secondary">плановий дохід</span>
                  <span className="text-sm font-bold">{plannedRevenue.toLocaleString()} ₴</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-secondary">реальний дохід</span>
                  <span className="text-sm font-bold text-emerald-600">{realRevenue.toLocaleString()} ₴</span>
                </div>
              </div>
              {periodEvents.length > 0 && (
                <div className="space-y-1.5">
                  {periodEvents.map(event => (
                    <div key={event.id} className="p-2 bg-[#F1EEE7] border border-[#E8E5DC] rounded-lg">
                      <p className="font-medium text-sm">{event.title}</p>
                      <p className="text-xs text-secondary">{formatDateUkrainian(event.date)} • {event.price} ₴ {event.altegio_booked_count != null ? `• ${event.altegio_booked_count}/${event.spots}` : ''}</p>
                    </div>
                  ))}
                </div>
              )}
              {cancelledEvents.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-red-500 mb-2">скасовані</p>
                  <div className="space-y-1.5">
                    {cancelledEvents.map(event => (
                      <div key={event.id} className="p-2 bg-red-50 border border-red-100 rounded-lg">
                        <p className="font-medium text-sm text-red-700">{event.title}</p>
                        <p className="text-xs text-red-500">{formatDateUkrainian(event.date)} • {event.price} ₴</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MANAGER */}
        {renderStatsColumn("MANAGER", managerOnTime, managerLate, managerUncompleted)}

        {/* SMM */}
        {renderStatsColumn("SMM", smmOnTime, smmLate, smmUncompleted)}

        {/* MARKETER */}
        {renderStatsColumn("MARKETER", marketerOnTime, marketerLate, marketerUncompleted)}
      </div>

      {/* Task Detail Dialog */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent className="dialog-content sm:max-w-[340px]">
          {selectedTask && (
            <>
              <DialogHeader className="pb-1">
                <DialogTitle className="text-xs font-medium">{selectedTask.name}</DialogTitle>
                <DialogDescription className="text-xs text-secondary">{selectedTask.event}</DialogDescription>
              </DialogHeader>
              <div className="py-3 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5 text-secondary" />
                  <span className="text-secondary">дедлайн:</span>
                  <span>{formatDateUkrainian(selectedTask.date)}</span>
                </div>
                {selectedTask.completedAt && (
                  <div className="flex items-center gap-2 text-xs">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-secondary">виконано:</span>
                    <span>{new Date(selectedTask.completedAt).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )}
              </div>
              <DialogFooter className="mt-2">
                <button className="btn-dark w-full h-8 text-xs" onClick={() => handleRestoreTask(selectedTask)}>відновити</button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Responsive wrapper
// Expanded desktop events workspace. Reached by clicking the Maximize2
// button on the dashboard ПОДІЇ column. Four columns:
//   1) Calendar (with month nav, sticky in its own column)
//   2) Scrollable list of future events
//   3) Selected event metadata + Altegio bookings
//   4) Today + overdue tasks for that event, accordion by role
const EventsDesktopExpanded = () => {
  const { events, smmTasksDefinition, allTaskDefs, settings, refreshEvents } = useApp();
  const navigate = useNavigate();
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [openRoles, setOpenRoles] = useState({ management: false, smm: false, marketing: false });
  const [exportingEvent, setExportingEvent] = useState(false);
  const [syncingEvent, setSyncingEvent] = useState(false);
  const listRef = useRef(null);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayStr = formatDateLocal(today);

  const allEvents = useMemo(() => getVisibleEventsForMonth(events, currentMonth, today), [events, currentMonth, today]);

  // Auto-select the closest visible event when month/list changes.
  useEffect(() => {
    if (allEvents.length === 0) {
      setSelectedEventId(null);
      return;
    }
    if (!selectedEventId || !allEvents.some(event => event.id === selectedEventId)) {
      setSelectedEventId(allEvents[0].id);
    }
  }, [allEvents, selectedEventId]);

  const selectedEvent = useMemo(() =>
    events.find(e => e.id === selectedEventId), [events, selectedEventId]);

  // When the selected event changes (e.g. via calendar click), pull the
  // matching card into view inside the list column. rAF gives React a tick
  // to commit the new selected styling before we scroll.
  useEffect(() => {
    if (!selectedEvent || !listRef.current) return;
    const datePart = (selectedEvent.date || '').split('T')[0];
    const card = listRef.current.querySelector(`[data-event-date="${datePart}"]`);
    if (card) {
      requestAnimationFrame(() => {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [selectedEvent]);

  // ESC closes the expanded view and returns to the dashboard.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') navigate('/'); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [navigate]);

  // Detail-card actions (same behaviour as the popup version in DesktopDashboard).
  const handleExportCalendar = async () => {
    if (!selectedEvent) return;
    setExportingEvent(true);
    try { await api.exportEventToCalendar(selectedEvent.id); toast.success("додано до календаря"); refreshEvents(); }
    catch { toast.error("помилка експорту"); }
    finally { setExportingEvent(false); }
  };
  const handleSyncAltegio = async () => {
    if (!selectedEvent) return;
    setSyncingEvent(true);
    try { await api.syncEventFromAltegio(selectedEvent.id); toast.success("синхронізовано"); refreshEvents(); }
    catch { toast.error("помилка синхронізації"); }
    finally { setSyncingEvent(false); }
  };
  const handleOpenAltegio = async () => {
    if (!selectedEvent) return;
    try {
      const r = await api.getEventAltegioUrl(selectedEvent.id);
      const url = r.data?.activity_url || r.data?.url;
      if (!url) throw new Error("No Altegio URL");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch { toast.error("не вдалося відкрити Altegio"); }
  };
  const handleCancelSelected = async () => {
    if (!selectedEvent) return;
    await cancelEventAndArchive(selectedEvent, { refreshEvents });
  };
  const handleDeleteSelected = async () => {
    if (!selectedEvent) return;
    await deleteEventPermanentlyFlow(selectedEvent, {
      refreshEvents,
      onDeleted: () => setSelectedEventId(null),
      onCancelled: () => setSelectedEventId(selectedEvent.id),
    });
  };
  const handleRestoreSelected = async () => {
    if (!selectedEvent) return;
    try { await axios.patch(`${API}/events/${selectedEvent.id}`, { cancelled: false }); toast.success("відновлено"); refreshEvents(); }
    catch { toast.error("помилка"); }
  };

  // Tasks for the selected event: overdue (uncompleted) + today, per role.
  const tasksByRole = useMemo(() => {
    const empty = { management: [], smm: [], marketing: [] };
    if (!selectedEvent) return empty;
    const result = { management: [], smm: [], marketing: [] };

    const push = (key, defs, completedMap, taskMap) => {
      Object.entries(taskMap || {}).forEach(([id, dateStr]) => {
        const completed = !!(completedMap || {})[id];
        const isOverdue = dateStr < todayStr;
        const isToday = dateStr === todayStr;
        if ((isOverdue && !completed) || isToday) {
          const def = (defs || []).find(t => t.id === id);
          result[key].push({ id, date: dateStr, name: def?.name || id, completed, isOverdue, isToday });
        }
      });
    };

    push('management', allTaskDefs.management || settings?.reminder_types, selectedEvent.completed_tasks, selectedEvent.reminders);
    push('smm', smmTasksDefinition.length ? smmTasksDefinition : (allTaskDefs.smm || []), selectedEvent.completed_smm_tasks, selectedEvent.smm_tasks);
    push('marketing', allTaskDefs.marketing || [], selectedEvent.completed_marketing_tasks, selectedEvent.marketing_tasks);

    // Sort: overdue first (oldest first), then today.
    Object.keys(result).forEach(k => {
      result[k].sort((a, b) => a.date.localeCompare(b.date));
    });
    return result;
  }, [selectedEvent, allTaskDefs, smmTasksDefinition, settings, todayStr]);

  const todayFormatted = formatDateWithWeekday(new Date());

  return (
    <div className="desktop-dashboard" data-testid="events-desktop-expanded">
      <header className="desktop-header">
        <div className="desktop-header-left gap-4">
          <h1 className="logo" style={{ textTransform: 'none' }}>Poriadok</h1>
          <span className="text-sm text-secondary lowercase">{todayFormatted.weekday} • {todayFormatted.day} {todayFormatted.month} · події</span>
        </div>
        <div className="desktop-header-right">
          <button className="btn-dark" onClick={() => navigate("/event/new")} data-testid="events-expand-new-btn"><Plus className="w-4 h-4" /><span>подія</span></button>
          <button
            className="flex items-center gap-2 rounded-full pl-2 transition-colors hover:bg-black/5"
            onClick={() => navigate('/')}
            title="закрити"
            data-testid="events-expand-close-btn"
          >
            <span className="text-xs text-secondary flex items-center gap-1 whitespace-nowrap font-normal">або <kbd className="px-1.5 py-0.5 bg-[rgba(243,238,226,0.1)] rounded text-[10px] font-mono border border-[rgba(243,238,226,0.16)]">ESC</kbd> щоб закрити</span>
            <span className="desktop-header-btn"><X className="w-5 h-5" /></span>
          </button>
        </div>
      </header>

      <div className="desktop-columns-4">
        {/* Col 1: Calendar — has its own scroll so it stays put as list scrolls. */}
        <div className="desktop-column">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-wide" style={{ color: '#1A1717' }}>КАЛЕНДАР</span>
              <div className="flex items-center gap-1">
                <button className="p-0.5 hover:bg-black/5 rounded-full transition-colors" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}><ChevronLeft className="w-3.5 h-3.5 text-secondary" /></button>
                <span className="text-xs font-medium text-secondary min-w-[60px] text-center">{UK_MONTHS_NOMINATIVE[currentMonth.getMonth()]}</span>
                <button className="p-0.5 hover:bg-black/5 rounded-full transition-colors" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}><ChevronRight className="w-3.5 h-3.5 text-secondary" /></button>
              </div>
            </div>
            <button
              className="p-1.5 rounded-full hover:bg-black/5 transition-colors text-secondary"
              onClick={() => navigate("/")}
              title="згорнути календар"
              data-testid="events-collapse-btn"
            ><Minimize2 className="w-4 h-4" /></button>
          </div>
          <div className="column-content">
            <div className="calendar-container-desktop">
              <Calendar
                mode="single"
                locale={uk}
                weekStartsOn={1}
                month={currentMonth}
                onMonthChange={setCurrentMonth}
                selected={selectedEvent ? new Date(selectedEvent.date) : undefined}
                onSelect={(date) => {
                  if (!date) return;
                  const dStr = formatDateLocal(date);
                  const ev = allEvents.find(e => e.date.startsWith(dStr));
                  if (ev) setSelectedEventId(ev.id);
                }}
                className="w-full calendar-minimal calendar-wide !p-1"
                classNames={{ month: "space-y-0 w-full", caption: "hidden", row: "flex w-full", head_row: "flex w-full", table: "w-full border-collapse" }}
                modifiersClassNames={{ today: "calendar-today-visible" }}
                components={{
                  DayContent: ({ date }) => {
                    return renderEventCalendarDay(date, events, currentMonth, today);
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Col 2: Events list — scrollable, calendar stays put in col 1 */}
        <div className="desktop-column">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold tracking-wide" style={{ color: '#1A1717' }}>СПИСОК</span>
            <span className="text-xs text-secondary">{allEvents.length}</span>
          </div>
          <div className="column-content" ref={listRef}>
            <div className="events-list space-y-1">
              {allEvents.length === 0 && <p className="text-center text-secondary text-sm py-8">немає активних подій</p>}
              {allEvents.map(event => {
                const eventDate = new Date(event.date);
                const isSelected = event.id === selectedEventId;
                return (
                  <div
                    key={event.id}
                    className={`event-card-desktop cursor-pointer transition-all${getEventArchiveClass(event, today)} ${isSelected ? 'ring-2 ring-[#1A1717]/20 bg-black/[0.04]' : 'hover:bg-black/[0.02]'}`}
                    onClick={() => setSelectedEventId(event.id)}
                    data-event-date={event.date.split('T')[0]}
                  >
                    <div className="date-badge-desktop">
                      <span className="date-badge-month">{['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][eventDate.getDay()]}</span>
                      <span className="date-badge-day">{eventDate.getDate()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{event.title}</p>
                      <p className="text-xs text-secondary">{UK_MONTHS_SHORT[eventDate.getMonth()]} · {event.price} ₴</p>
                    </div>
                    <EventArchiveIcon event={event} today={today} />
                    {event.altegio_booked_count != null && (
                      <div className="text-right">
                        <span className={`text-sm font-bold ${getBookingColorClass(getBookingStatusColor(event))}`}>
                          {event.altegio_booked_count}/{event.spots || 10}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Col 3: Event card — same layout as the dashboard's event-detail popup. */}
        <div className="desktop-column">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold tracking-wide" style={{ color: '#1A1717' }}>ПОДІЯ</span>
            {selectedEvent?.title && <span className="text-xs text-secondary truncate ml-2">{selectedEvent.title}</span>}
          </div>
          <div className="column-content">
            {!selectedEvent ? (
              <p className="text-center text-secondary text-sm py-8">обери подію зі списку</p>
            ) : (
              <>
                <div className="section-card">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                      <span className="text-secondary text-sm">дата</span>
                      <span className="font-medium">{formatDateUkrainian(selectedEvent.date)}</span>
                    </div>
                    {selectedEvent.start_time && (
                      <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                        <span className="text-secondary text-sm">час</span>
                        <span className="font-medium">{selectedEvent.start_time}{selectedEvent.end_time ? ` — ${selectedEvent.end_time}` : ''}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                      <span className="text-secondary text-sm">ціна</span>
                      <span className="font-medium">{selectedEvent.price} ₴</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-[#E8E5DC]">
                      <span className="text-secondary text-sm">учасники</span>
                      {(selectedEvent.altegio_booked_count !== null && selectedEvent.altegio_booked_count !== undefined) ? (
                        <span className={`font-bold ${getBookingColorClass(getBookingStatusColor(selectedEvent))}`}>
                          {selectedEvent.altegio_booked_count}/{selectedEvent.spots || 10}
                        </span>
                      ) : (
                        <span className="font-medium">0/{selectedEvent.spots || 10}</span>
                      )}
                    </div>
                    {selectedEvent.description && (
                      <div className="py-2">
                        <span className="text-secondary text-sm block mb-1">опис</span>
                        <p className="text-sm">{selectedEvent.description}</p>
                      </div>
                    )}
                  </div>
                  {selectedEvent.cancelled && (
                    <div className="mt-4 p-3 bg-red-50 rounded-lg text-center">
                      <p className="text-red-600 font-medium">подію скасовано</p>
                    </div>
                  )}
                </div>

                <div className="section-card mt-4">
                  <p className="text-xs text-secondary mb-3">синхронізація</p>
                  <div className="flex gap-2">
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition-colors" onClick={handleExportCalendar} disabled={exportingEvent}>
                      <ExternalLink className="w-4 h-4" /><span>{exportingEvent ? "..." : "Calendar"}</span>
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition-colors" onClick={handleSyncAltegio} disabled={syncingEvent}>
                      <RefreshCw className={`w-4 h-4 ${syncingEvent ? 'animate-spin' : ''}`} /><span>{syncingEvent ? "..." : "Altegio"}</span>
                    </button>
                    <button className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition-colors" onClick={handleOpenAltegio}>
                      <ExternalLink className="w-4 h-4" /><span>відкрити</span>
                    </button>
                  </div>
                  {selectedEvent.altegio_last_sync && (
                    <p className="text-xs text-secondary mt-2 text-center">оновлено: {new Date(selectedEvent.altegio_last_sync).toLocaleString('uk-UA')}</p>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  <Button variant="outline" className="flex-1" onClick={() => navigate(`/event/${selectedEvent.id}`)}>
                    <Edit className="w-4 h-4 mr-2" />редагувати
                  </Button>
                  {!selectedEvent.cancelled ? (
                    <Button variant="outline" className="flex-1 text-orange-600 border-orange-200 hover:bg-orange-50" onClick={handleCancelSelected}>
                      <X className="w-4 h-4 mr-2" />скасувати
                    </Button>
                  ) : (
                    <Button variant="outline" className="flex-1 text-green-600 border-green-200 hover:bg-green-50" onClick={handleRestoreSelected}>
                      <RotateCcw className="w-4 h-4 mr-2" />відновити
                    </Button>
                  )}
                  <button className="w-11 h-11 rounded-full border border-[#FF8370]/35 text-[#FF8370] hover:bg-[#FF8370]/10 flex items-center justify-center" onClick={handleDeleteSelected} title="видалити назавжди">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Col 4: Tasks accordion (overdue + today only) */}
        <div className="desktop-column">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold tracking-wide" style={{ color: '#1A1717' }}>ЗАДАЧІ</span>
            <span className="text-xs text-secondary">протерміновано + сьогодні</span>
          </div>
          <div className="column-content">
            {!selectedEvent ? (
              <p className="text-center text-secondary text-sm py-8">обери подію</p>
            ) : (
              <div className="space-y-2">
                {[
                  { key: 'management', label: 'MANAGER' },
                  { key: 'smm', label: 'SMM' },
                  { key: 'marketing', label: 'MARKETER' },
                ].map(({ key, label }) => {
                  const list = tasksByRole[key];
                  const isOpen = openRoles[key];
                  const overdueCount = list.filter(t => t.isOverdue).length;
                  const hasUrgent = overdueCount > 0;
                  return (
                    <div key={key} className="rounded-xl border border-black/5 overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between p-3 hover:bg-black/[0.02] transition-colors"
                        onClick={() => setOpenRoles(r => ({ ...r, [key]: !r[key] }))}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold tracking-wide" style={{ color: '#1A1717' }}>{label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${hasUrgent ? 'bg-red-100 text-red-600' : list.length === 0 ? 'bg-green-50 text-green-700' : 'bg-black/5 text-secondary'}`}>
                            {list.length === 0 ? '0' : hasUrgent ? `${list.length} · ${overdueCount} протерм` : `${list.length}`}
                          </span>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isOpen && (
                        <div className="border-t border-black/5">
                          {list.length === 0 ? (
                            <p className="text-xs text-secondary p-3 text-center">все в порядку</p>
                          ) : (
                            <ul className="p-2 space-y-1">
                              {list.map(t => (
                                <li key={t.id} className={`text-sm p-2 rounded-lg flex items-center justify-between ${t.isOverdue ? 'bg-red-50/60' : ''}`}>
                                  <span className="truncate pr-2">{t.name}</span>
                                  <span className={`text-xs whitespace-nowrap ${t.isOverdue ? 'text-red-600 font-medium' : 'text-secondary'}`}>
                                    {formatDateUkrainian(t.date)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Renders the mobile `children` below 1024px; on desktop renders the
// optional `desktop` prop or falls back to DesktopDashboard. Letting routes
// supply their own desktop element keeps us from hard-coding one page.

const AccessGate = ({ onUnlock }) => {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    if (code.trim() === ACCESS_CODE) {
      localStorage.setItem(ACCESS_CODE_STORAGE_KEY, "true");
      setError("");
      onUnlock();
      return;
    }
    setError("невірний код");
    setCode("");
  };

  return (
    <div className="app-container min-h-screen flex items-center justify-center px-6">
      <Toaster position="top-center" richColors />
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-[32px] p-8 shadow-sm" style={{ background: 'var(--panel-bg, #F1EEE7)' }}>
        <h1 className="logo mb-8 text-center" style={{ textTransform: 'none' }}>Poriadok</h1>
        <label className="block text-xs font-semibold uppercase tracking-wide text-secondary mb-2">код доступу</label>
        <input
          autoFocus
          inputMode="numeric"
          value={code}
          onChange={(event) => { setCode(event.target.value); setError(""); }}
          className="w-full h-14 rounded-2xl px-5 text-center text-2xl font-semibold outline-none border border-black/10 bg-white/45 focus:border-black"
          type="password"
          aria-label="код доступу"
        />
        <button type="submit" className="btn-dark w-full h-12 mt-5">увійти</button>
        {error && <p className="text-center text-sm mt-4" style={{ color: '#FF8370' }}>{error}</p>}
      </form>
    </div>
  );
};

const ResponsiveWrapper = ({ children, desktop }) => {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  useEffect(() => { const h = () => setIsDesktop(window.innerWidth >= 1024); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);

  if (isDesktop) return desktop || <DesktopDashboard />;
  return children;
};

// Theme Context
// Main App
function App() {
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [standaloneTasks, setStandaloneTasks] = useState([]);
  const [smmTasksDefinition, setSmmTasksDefinition] = useState([]);
  const [allTaskDefs, setAllTaskDefs] = useState({ management: [], smm: [], marketing: [], monthly: [], daily: [] });
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState({ connected: false, email: null });
  const [loading, setLoading] = useState(true);
  const [accessGranted, setAccessGranted] = useState(() => localStorage.getItem(ACCESS_CODE_STORAGE_KEY) === "true");
  const undoStackRef = useRef([]);

  const pushUndo = useCallback((entry) => {
    if (!entry?.run) return;
    undoStackRef.current = [entry, ...undoStackRef.current].slice(0, 20);
  }, []);

  const performUndo = useCallback(async ({ silentEmpty = false } = {}) => {
    const entry = undoStackRef.current.shift();
    if (!entry) {
      if (!silentEmpty) toast.message("немає що відміняти");
      return false;
    }
    try {
      await entry.run();
      toast.success(`відмінено: ${entry.label || "остання дія"}`);
      return true;
    } catch (error) {
      console.error(error);
      toast.error("не вдалося відмінити");
      return false;
    }
  }, []);

  const refreshEvents = async () => { try { const r = await api.getEvents(); setEvents(r.data); } catch (e) { console.error(e); } };
  const refreshSettings = async () => { try { const r = await api.getSettings(); setSettings(r.data); } catch (e) { console.error(e); } };
  const refreshStandaloneTasks = async () => { try { const r = await api.getStandaloneTasks(); setStandaloneTasks(r.data); } catch (e) { console.error(e); } };
  const refreshSMMTasksDefinition = async () => { try { const r = await api.getSMMTasksDefinition(); const data = r.data; if (data.smm) { setAllTaskDefs(data); setSmmTasksDefinition([...data.management, ...data.smm, ...data.marketing]); } else { setSmmTasksDefinition(Array.isArray(data) ? data : []); } } catch (e) { console.error(e); } };
  const refreshGoogleStatus = async () => {
    try {
      const r = await axios.get(`${API}/oauth/calendar/status`);
      setGoogleCalendarStatus(r.data);
    } catch (e) { console.error(e); }
  };

  // Check for Google OAuth callback on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected") === "true") {
      toast.success("Google Calendar підключено! Нові події будуть автоматично синхронізуватися.");
      refreshGoogleStatus();
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get("error")) {
      toast.error("Помилка підключення Google Calendar");
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!accessGranted) return;
    Promise.all([
      refreshEvents(),
      refreshSettings(),
      refreshStandaloneTasks(),
      refreshSMMTasksDefinition(),
      refreshGoogleStatus()
    ]).then(() => setLoading(false));
  }, [accessGranted]);

  useEffect(() => {
    if (!accessGranted) return;
    const handleUndoKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || String(event.key).toLowerCase() !== 'z') return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      performUndo();
    };
    window.addEventListener('keydown', handleUndoKey);
    return () => window.removeEventListener('keydown', handleUndoKey);
  }, [accessGranted, performUndo]);

  useEffect(() => {
    if (!accessGranted) return;
    let lastShakeAt = 0;
    let permissionAsked = false;
    const handleMotion = (event) => {
      const a = event.accelerationIncludingGravity;
      if (!a) return;
      const force = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
      const now = Date.now();
      if (force > 45 && now - lastShakeAt > 1400) {
        lastShakeAt = now;
        performUndo({ silentEmpty: true });
      }
    };
    const enableMotion = async () => {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function' && !permissionAsked) {
        permissionAsked = true;
        try {
          const result = await DeviceMotionEvent.requestPermission();
          if (result !== 'granted') return;
        } catch { return; }
      }
      window.addEventListener('devicemotion', handleMotion);
    };
    window.addEventListener('devicemotion', handleMotion);
    window.addEventListener('pointerdown', enableMotion, { once: true });
    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      window.removeEventListener('pointerdown', enableMotion);
    };
  }, [accessGranted, performUndo]);

  if (!accessGranted) return <AccessGate onUnlock={() => { setAccessGranted(true); setLoading(true); }} />;

  if (loading) return <div className="app-container flex items-center justify-center min-h-screen"><div className="text-center"><h1 className="logo mb-2" style={{ textTransform: 'none' }}>Poriadok</h1><p className="text-secondary text-sm">завантажую...</p></div></div>;

  return (
      <UndoContext.Provider value={{ pushUndo, performUndo }}>
      <AppContext.Provider value={{ events, settings, standaloneTasks, smmTasksDefinition, allTaskDefs, googleCalendarStatus, refreshEvents, refreshSettings, refreshStandaloneTasks, refreshGoogleStatus, refreshSMMTasksDefinition }}>
        <BrowserRouter>
          <div className="app-container">
            <Toaster position="top-center" richColors />
            <Routes>
              <Route path="/" element={<ResponsiveWrapper><Dashboard /></ResponsiveWrapper>} />
              <Route path="/events" element={<ResponsiveWrapper desktop={<EventsDesktopExpanded />}><EventsPage /></ResponsiveWrapper>} />
              <Route path="/smm" element={<SMMPage />} />
              <Route path="/task/new" element={<NewTaskPage />} />
              <Route path="/smm/task/new" element={<NewSMMTaskPage />} />
              <Route path="/event/new" element={<EventForm />} />
              <Route path="/event/:id" element={<EventForm />} />
              <Route path="/event/:id/view" element={<EventDetailPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/analytics" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/cal" element={<CalendarFullPage />} />
              <Route path="/content" element={<ContentPage />} />
            </Routes>
          </div>
        </BrowserRouter>
      </AppContext.Provider>
      </UndoContext.Provider>
  );
}

export default App;
