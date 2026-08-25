# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI Music Video Studio — a browser-based video/storyboard editor for AI-generated music videos, plus a thin Express backend that proxies paid AI generation APIs (KIE.ai, Google Gemini) so the API keys stay server-side. There is no frontend build step and no bundler: `index.html` loads every `js/*.js` file as plain non-module `<script>` tags in a deliberate dependency order, and they all share one global scope.

## Commands

```bash
npm install       # install backend deps
npm start          # node server.js — serves the static frontend AND the API on one port
```

No test suite, no lint config, no build step exist in this repo. There is nothing to run beyond `npm start`; verify frontend changes by loading the app in a browser against the running server.

One-time bootstrap (creates the first admin account — the login screen gates the entire app, so this must be run before anyone can log in):

```bash
node scripts/create-admin.js "<name>" "<login>" "<password>"
```

Safe to re-run (upserts on `login`, so it also works to reset a password).

### Required environment variables

- `DATABASE_URL` — Postgres connection string. If unset, `db.js` runs with `pool = null` and every DB-touching route degrades gracefully (no crash, but auth/admin/tokens won't work).
- `KIE_API_KEY` — KIE.ai unified generation API.
- `GEMINI_API_KEY` — Google Gemini (script analysis, text assist).
- `SESSION_SECRET` — signs the auth cookie.
- `PORT` — defaults per Railway; `RAILWAY_PUBLIC_DOMAIN` / `PUBLIC_URL` are used to build absolute webhook callback URLs for KIE.

## Branches & deploy

- `main` and `dev` currently point at the same commit — there is no permanent divergence between them; treat `dev` as where work lands and `main` as what's deployed/stable when they do diverge.
- No CI config, no Dockerfile, no `railway.json`/Procfile in the repo — deploy is inferred to be Railway's git-push auto-deploy (Node app detected via `package.json`'s `start` script), consistent with `scripts/create-admin.js` mentioning "Railway's Console tab" and `db.js` special-casing `*.railway.internal` connection strings.
- Committing and pushing to `origin` (both `dev` and `main`) works from this environment — always confirm with the user before pushing, per standard workflow.

## Architecture

### Backend (`server.js`, `db.js`)

Single Express app that does three jobs:

1. **Serves the static frontend** (`express.static(__dirname)`) — same origin as the API, no CORS needed for the app itself.
2. **Auth + token ledger** — signed httpOnly-cookie sessions (`requireAuth`/`requireAdmin` middleware), bcrypt passwords, a `users` table in Postgres (`id, name, login, password_hash, tokens, is_admin, last_login, created_at` — the *only* table; there are no project/asset tables server-side). Admin routes enforce that the sum of all non-admin users' token balances never exceeds the real KIE.ai credit balance.
3. **AI generation proxy** — every paid generation (image, video, lip-sync, photo-lipsync, motion-control, video-edit, object-remover) goes through KIE.ai's unified `POST /api/v1/jobs/createTask` API. Each feature has a `/start` route that checks/deducts the user's token balance first. Async job results come back via `POST /api/webhook/kie`; `GET /api/generate-image/status` is a fallback poller used when no webhook has landed within ~20s. There are no websockets/SSE — the frontend polls status endpoints. Gemini is used only for text: generic text-assist and structured script-to-scenes/characters/locations/props analysis (via `responseSchema` JSON mode).

Project data (scenes, shots, assets, etc.) **never touches the backend or Postgres** — it lives entirely client-side (see Persistence below). The backend only knows about users/tokens and in-flight generation tasks (kept in an in-memory `Map`, not persisted).

### Frontend (`index.html` + `js/*.js`)

Classic shared-mutable-global architecture, no framework, no event bus:

- `js/state.js` loads first and defines the single global `state` object (music/band/looks/locations/props/scenes categories, `scenes[]`, `timelineAudio`, `taskQueue[]`, `archive[]`, `script`, etc.) plus loose top-level globals (zoom/px-per-second, playhead position, etc.). Every other module reads and mutates `state` and the DOM directly.
- `js/app.js` loads last and bootstraps: checks `/api/me` to gate on login, wires up every UI section, starts the background task watcher, restores the last-active project (or shows the project picker), and installs global keyboard shortcuts.
- The main screen (`#app`) has a topbar menu and page tabs: **SCRIPT** → **WORK** (default; the main editor: assets panel + preview/transport/timeline + inspector) → **TASKS** (generation queue) → **ARCHIVE** (every successful generation ever made) → **ANIMATIC** (batch image→video on existing shots) → **MOVIE** (final ffmpeg.wasm render/export).
- `panel_r2d2.html` is a separate, unlinked (`noindex`) admin page for user/token management — reuses `styles.css` and `js/admin.js`, hits the same `/api/admin/users` backend routes.

Feature-area modules (each owns one gallery/tab/concern): `characters.js` (Band), `locations.js`, `props.js`, `looks.js`, `music.js` (galleries); `timeline.js`, `audio-track.js`, `transport.js`, `scenes-preview.js` (WORK editor); `tasks.js` (generation queue UI, second-largest file); `archive.js`, `movie.js`, `render.js` (later pipeline stages); `script-tab.js` (Gemini script analysis), `check.js` (pre-flight consistency audit before spending credits), `lipsync.js`, `object-card.js`, `storyboard.js`, `credits.js`, `gemini-chat.js`, `tags.js`, `panels.js` (resizable panel drag), `helpers.js`.

### Persistence (`js/persistence.js`, 1582 lines — largest file, own subsystem)

Implements `ProjectStore`: **all project data is client-side only**, two interchangeable backends per project:

- **IndexedDB** (default) — DB `ai_mv_studio_db`, stores `project`/`projectMeta`/`handles`/`assets`/`app`, namespaced by `projectId`.
- **File System Access API** (opt-in, Chromium-only) — writes a real `project.json` + `assets/` folder to disk.

`serializeProject()` produces `{version, savedAt, projectMeta, categories[], scenes[], timelineAudio, voiceTracks, focus, timelineMode, playheadX, taskQueue, archive, script, seq{...}}`. Binary assets (images/audio) are stripped from the JSON and stored separately as Blobs/files, restored via per-category `restore*Images` functions. Autosave runs every 3s, gated on an actual JSON diff, plus a save-on-tab-hide safety net. Also owns multi-project list management and the disk-folder reconnect/permission flow. `js/project-export.js` is the separate whole-project ZIP export/import path (lazy-loads JSZip from CDN) for backup/machine-to-machine moves — distinct from the IndexedDB/disk persistence above.
