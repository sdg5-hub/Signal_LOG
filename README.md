# SIGNAL LOG

SIGNAL LOG is an original deep-space themed guestbook web app where visitors submit short "transmissions" that appear in a live scrolling log. It is built with Express + SQLite and plain HTML/CSS/JS, with anti-spam protections and moderation tools.
SIGNAL_LOG is live at: https://signal-log.onrender.com (takes 30-40 seconds to load)
## Features

- Original deep-space receiver visual identity (deep navy, neon cyan, magenta accents)
- Visitor transmission form with:
  - Callsign (optional, max 24)
  - Origin (optional, max 32)
  - Message (required, max 300)
  - Human math check token flow
  - Honeypot anti-spam field
- Live log feed:
  - Newest-first entries
  - Local readable timestamp + ISO timestamp
  - Signal strength indicator (0-100)
  - Copy action per entry
  - Report action per entry
- Search + filters:
  - Server-side message search (`q`)
  - Origin filters (`ALL`, `EARTH`, `UNKNOWN`, `CUSTOM`)
  - Pagination with 50-entry pages
- Admin moderation:
  - `/admin` page with token input
  - Delete messages with `x-admin-token`
- SQLite schema with `messages` and `reports` tables

## Tech Stack

- Node.js 20+
- Express
- SQLite with `better-sqlite3`
- Plain HTML/CSS/JS (`/public`)
- ESM modules

## Project Structure

- `/Users/osamahgilani/Documents/New project/server.js`
- `/Users/osamahgilani/Documents/New project/db.js`
- `/Users/osamahgilani/Documents/New project/package.json`
- `/Users/osamahgilani/Documents/New project/.env.example`
- `/Users/osamahgilani/Documents/New project/public/index.html`
- `/Users/osamahgilani/Documents/New project/public/styles.css`
- `/Users/osamahgilani/Documents/New project/public/app.js`
- `/Users/osamahgilani/Documents/New project/README.md`

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env
```

3. Set `ADMIN_TOKEN` in `.env`.

4. Run in development:

```bash
npm run dev
```

5. Run in production mode:

```bash
npm start
```

App runs at: [ https://signal-log.onrender.com ]( https://signal-log.onrender.com )

## Environment Variables

- `PORT` (default: `3000`)
- `ADMIN_TOKEN` (required for admin delete endpoint)

Example:

```env
PORT=3000
ADMIN_TOKEN=replace-with-strong-random-token
```

## API

### `GET /api/human-check`
Returns a one-time math challenge:

```json
{ "token": "...", "question": "7 + 4 = ?" }
```

### `GET /api/messages?limit=50&offset=0&q=...&origin=...`
Returns paginated messages:

```json
{
  "items": [
    {
      "id": 1,
      "created_at": "2026-02-18T00:00:00.000Z",
      "callsign": "Nomad-7",
      "origin": "Earth",
      "message": "Hello from orbit",
      "strength": 72
    }
  ],
  "total": 1
}
```

### `POST /api/messages`
Body:

```json
{
  "callsign": "Nomad-7",
  "origin": "Earth",
  "message": "Hello from orbit",
  "humanAnswer": "11",
  "humanToken": "...",
  "website": ""
}
```

### `POST /api/report/:id`
Body:

```json
{ "reason": "optional reason" }
```

### `DELETE /api/messages/:id`
Requires header:

```http
x-admin-token: <ADMIN_TOKEN>
```

All API errors return:

```json
{ "error": "..." }
```

## Deployment Notes

GitHub Pages cannot host this app because it only serves static files and cannot run the Express/SQLite backend.

Use one of these options:

### Option: Render.com

- Create a new Web Service from your repo
- Build command: `npm install`
- Start command: `npm start`
- Add env vars: `PORT`, `ADMIN_TOKEN`
- Attach persistent disk for SQLite file retention

## Security

- In-memory per-IP rate limiting:
  - max 10 POSTs/hour
  - min 10s between posts
- Human check token challenge with short TTL
- Honeypot field blocks naive bot submissions
- XSS-safe rendering on frontend using `textContent` for message content
- No IP addresses stored in SQLite (rate limit state is memory-only and reset on restart)
- Helmet security headers + constrained CSP

## Notes

- Database file: `signal-log.db` is created automatically in the project root.
- Admin token is not persisted by default; admin page supports optional `sessionStorage` remember mode.
