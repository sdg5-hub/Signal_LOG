import express from 'express';
import helmet from 'helmet';
import {
  createMessage,
  deleteMessage,
  getMessageById,
  listMessages,
  reportMessage
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.static('public', { extensions: ['html'] }));

const humanChecks = new Map();
const humanCheckTTL = 5 * 60 * 1000;

const postRateByIp = new Map();
const rateWindowMs = 60 * 60 * 1000;
const maxPostsPerWindow = 10;
const minGapMs = 10 * 1000;

function jsonError(res, status, error) {
  return res.status(status).json({ error });
}

function nowIso() {
  return new Date().toISOString();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeHumanCheck() {
  const a = randomInt(2, 12);
  const b = randomInt(1, 12);
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const answer = String(a + b);
  humanChecks.set(token, { answer, expiresAt: Date.now() + humanCheckTTL });
  return { token, question: `${a} + ${b} = ?` };
}

function clearExpiredHumanChecks() {
  const now = Date.now();
  for (const [token, data] of humanChecks.entries()) {
    if (data.expiresAt <= now) {
      humanChecks.delete(token);
    }
  }
}

setInterval(clearExpiredHumanChecks, 60 * 1000).unref();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function enforcePostRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = postRateByIp.get(ip) || { recent: [], lastPostAt: 0 };
  entry.recent = entry.recent.filter((ts) => now - ts <= rateWindowMs);

  if (entry.lastPostAt && now - entry.lastPostAt < minGapMs) {
    return jsonError(res, 429, 'Rate limit: wait at least 10 seconds between transmissions.');
  }
  if (entry.recent.length >= maxPostsPerWindow) {
    return jsonError(res, 429, 'Rate limit: maximum 10 transmissions per hour.');
  }

  entry.recent.push(now);
  entry.lastPostAt = now;
  postRateByIp.set(ip, entry);
  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of postRateByIp.entries()) {
    entry.recent = entry.recent.filter((ts) => now - ts <= rateWindowMs);
    if (entry.recent.length === 0 && now - entry.lastPostAt > rateWindowMs) {
      postRateByIp.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

function normalizeText(value, max) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, max);
}

function hasMeaningfulContent(text) {
  return /[\p{L}\p{N}]/u.test(text);
}

function isRepeatedSpam(text) {
  if (/(.)\1{7,}/u.test(text)) return true;
  const chars = [...text.replace(/\s+/g, '')];
  if (chars.length < 12) return false;
  const counts = new Map();
  for (const ch of chars) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  const most = Math.max(...counts.values());
  return most / chars.length >= 0.7;
}

function adminGuard(req, res, next) {
  if (!ADMIN_TOKEN) {
    return jsonError(res, 500, 'Admin token is not configured on server.');
  }
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_TOKEN) {
    return jsonError(res, 401, 'Unauthorized admin token.');
  }
  return next();
}

app.get('/api/human-check', (_req, res) => {
  const challenge = makeHumanCheck();
  return res.json(challenge);
});

app.get('/api/messages', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const query = normalizeText(req.query.q, 100);
  const origin = normalizeText(req.query.origin, 64);

  const result = listMessages({ limit, offset, query, origin });
  return res.json(result);
});

app.post('/api/messages', enforcePostRateLimit, (req, res) => {
  const payload = req.body || {};

  const callsign = normalizeText(payload.callsign, 24);
  const origin = normalizeText(payload.origin, 32);
  const message = normalizeText(payload.message, 300);
  const humanAnswer = normalizeText(payload.humanAnswer, 16);
  const humanToken = normalizeText(payload.humanToken, 64);
  const website = normalizeText(payload.website, 128);

  if (website) {
    return jsonError(res, 400, 'Spam detected.');
  }
  if (!message) {
    return jsonError(res, 400, 'Message is required.');
  }
  if (!hasMeaningfulContent(message)) {
    return jsonError(res, 400, 'Message must include at least one letter or number.');
  }
  if (isRepeatedSpam(message)) {
    return jsonError(res, 400, 'Message looks like repeated-character spam.');
  }
  if (!humanToken || !humanAnswer) {
    return jsonError(res, 400, 'Human check is required.');
  }

  const challenge = humanChecks.get(humanToken);
  if (!challenge || challenge.expiresAt < Date.now()) {
    humanChecks.delete(humanToken);
    return jsonError(res, 400, 'Human check expired. Request a new challenge.');
  }
  if (challenge.answer !== humanAnswer) {
    return jsonError(res, 400, 'Human check answer is incorrect.');
  }

  humanChecks.delete(humanToken);

  const created = createMessage({
    createdAt: nowIso(),
    callsign: callsign || null,
    origin: origin || null,
    message
  });

  return res.status(201).json(created);
});

app.post('/api/report/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError(res, 400, 'Invalid message id.');
  }

  const item = getMessageById(id);
  if (!item) {
    return jsonError(res, 404, 'Message not found.');
  }

  const reason = normalizeText((req.body || {}).reason, 160);
  reportMessage({
    messageId: id,
    createdAt: nowIso(),
    reason: reason || null
  });

  return res.status(201).json({ ok: true });
});

app.delete('/api/messages/:id', adminGuard, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError(res, 400, 'Invalid message id.');
  }

  const removed = deleteMessage(id);
  if (!removed) {
    return jsonError(res, 404, 'Message not found.');
  }

  return res.json({ ok: true });
});

app.get('/admin', (_req, res) => {
  return res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SIGNAL LOG Admin</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body data-page="admin">
    <div class="background-grid" aria-hidden="true"></div>
    <main class="shell">
      <header class="site-header">
        <h1>SIGNAL LOG: ADMIN</h1>
        <p class="subhead">Moderation uplink active. Inspect transmissions and remove flagged entries.</p>
      </header>

      <section class="admin-auth card">
        <h2>Admin Token</h2>
        <div class="admin-auth-row">
          <input id="admin-token" type="password" placeholder="Enter x-admin-token" autocomplete="off" />
          <button id="save-admin-token" class="btn btn-primary" type="button">Use Token</button>
        </div>
        <label class="remember-wrap"><input id="remember-token" type="checkbox" /> Remember in sessionStorage</label>
      </section>

      <section class="layout single-column">
        <div class="card">
          <div class="toolbar">
            <input id="search" class="input" type="search" placeholder="Search transmissions" />
            <button id="refresh-admin" class="btn btn-secondary" type="button">Refresh</button>
          </div>
          <div id="log-feed" class="log-feed"></div>
          <div class="pagination-row">
            <button id="load-more" class="btn btn-secondary" type="button">Load more</button>
          </div>
        </div>
      </section>
    </main>
    <div id="toast-root" class="toast-root" aria-live="polite"></div>
    <script src="/app.js" type="module"></script>
  </body>
</html>`);
});

app.use('/api', (_req, res) => jsonError(res, 404, 'API route not found.'));
app.use((err, _req, res, _next) => {
  console.error(err);
  return jsonError(res, 500, 'Internal server error.');
});

app.listen(PORT, () => {
  console.log(`SIGNAL LOG listening on http://localhost:${PORT}`);
});
