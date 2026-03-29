# Sensa - Team Task & Event Management App

## Core Architecture
- Frontend: React + Tailwind CSS + Shadcn UI + lucide-react
- Backend: Python FastAPI + MongoDB
- Integrations: Google Calendar (OAuth2), Altegio API (two-way sync), OpenAI (via Emergent LLM Key for AI text parsing)

## Column Order (everywhere): МЕНЕДЖМЕНТ -> SMM -> МАРКЕТИНГ
## Task Order in Columns: Щоденні -> По подіях -> Щомісячні

## Implemented Features
- 4-column desktop layout: ПОДІЇ, МЕНЕДЖМЕНТ, SMM, МАРКЕТИНГ
- Event creation: manual input by default, AI parse as toggle. Type: подія/регулярна
- Event title autocomplete from recent events with filtering
- Event Detail Page + Popup: 4 columns (ПОДІЯ/інфо, МЕНЕДЖМЕНТ, SMM, МАРКЕТИНГ) with task completion
- Settings: 4-column layout (ІНШЕ, МЕНЕДЖМЕНТ, SMM, МАРКЕТИНГ) with editing, scrollable columns
- Daily tasks auto-generated daily
- Monthly tasks auto-generated every 2 weeks, split by column with month name display
- Marketing monthly duplicates: план подій тімворк, контент-план тімворк
- Altegio two-way sync: 
  - PULL: booking count every 60 min + manual button
  - PUSH: create/update/delete activities via V2 API (requires partner token + service/staff IDs)
- Close button alignment, exclusive dropdowns, price from recent events, spots 8-13
- Content Plan page:
  - Month selector dropdown (click month name to pick from 12 months grid, year navigation)
  - Delete button and Completed checkbox on hover for Announcements, Stories, Info-posts
  - Completed items accordion (collapsed by default, styled like overdue accordion) at top of each column
  - Posts model with `completed` and `completed_at` fields, backend PATCH endpoint updated

## Altegio Two-Way Sync Details
- **Pull (V1 API)**: GET booking counts from Altegio → update `altegio_booked_count` on events. Runs every 60 min + manual sync button.
- **Push (V2 API)**: When creating/updating/deleting events in Sensa → push to Altegio as activities. Requires env vars:
  - `ALTEGIO_PARTNER_TOKEN` — Partner API token
  - `ALTEGIO_DEFAULT_SERVICE_ID` — Service ID for events
  - `ALTEGIO_DEFAULT_STAFF_ID` — Staff member ID
- **Регулярні події**: Altegio V2 doesn't support recurrence natively. Each occurrence must be created separately.

## Key DB Schema
- `events`: `{ id, title, date, task_overrides, smm_tasks, marketing_tasks, completed_marketing_tasks, altegio_activity_id, event_type, created_at }`
- `standalone_tasks`: `{ id, title, date, assignee, type (monthly/regular/daily), column, target_month }`
- `settings`: `{ id: "global_settings", reminder_types }`

## Key API Endpoints
- `POST /api/events`: Creates event + auto-pushes to Altegio (if configured)
- `PUT /api/events/{id}`: Updates event + syncs changes to Altegio
- `DELETE /api/events/{id}`: Deletes event + deletes from Altegio
- `PATCH /api/settings/task/{task_id}`: Edit task definition
- `POST /api/tasks/marketing/complete`: Complete marketing task
- `GET /api/altegio/status`: Connection + push status
- `GET /api/docs/app-logic.pdf`: PDF of app logic

## Future/Backlog
- **P0:** Refactor App.js (~5000 lines) into modular components
- **P2:** Mobile UI parity and polish
