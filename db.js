import Database from 'better-sqlite3';

const db = new Database('signal-log.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    callsign TEXT,
    origin TEXT,
    message TEXT NOT NULL,
    strength INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    reason TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_message_id ON reports(message_id);
`);

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (created_at, callsign, origin, message, strength)
  VALUES (@created_at, @callsign, @origin, @message, @strength)
`);

const updateMessageStrengthStmt = db.prepare(`
  UPDATE messages SET strength = ? WHERE id = ?
`);

const countMessagesBaseStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM messages
  WHERE 1=1
`);

const insertReportStmt = db.prepare(`
  INSERT INTO reports (message_id, created_at, reason)
  VALUES (@message_id, @created_at, @reason)
`);

const getMessageByIdStmt = db.prepare(`
  SELECT id, created_at, callsign, origin, message, strength
  FROM messages
  WHERE id = ?
`);

const deleteMessageStmt = db.prepare(`
  DELETE FROM messages WHERE id = ?
`);

const countMessagesStmtFactory = ({ hasQuery, hasOrigin, unknownOriginOnly }) => {
  let sql = `SELECT COUNT(*) AS total FROM messages WHERE 1=1`;
  if (hasQuery) sql += ` AND message LIKE @q`;
  if (unknownOriginOnly) {
    sql += ` AND (origin IS NULL OR TRIM(origin) = '' OR LOWER(origin) LIKE '%unknown%')`;
  } else if (hasOrigin) {
    sql += ` AND LOWER(COALESCE(origin, '')) LIKE @origin`;
  }
  return db.prepare(sql);
};

const listMessagesStmtFactory = ({ hasQuery, hasOrigin, unknownOriginOnly }) => {
  let sql = `
    SELECT id, created_at, callsign, origin, message, strength
    FROM messages
    WHERE 1=1
  `;
  if (hasQuery) sql += ` AND message LIKE @q`;
  if (unknownOriginOnly) {
    sql += ` AND (origin IS NULL OR TRIM(origin) = '' OR LOWER(origin) LIKE '%unknown%')`;
  } else if (hasOrigin) {
    sql += ` AND LOWER(COALESCE(origin, '')) LIKE @origin`;
  }
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit OFFSET @offset`;
  return db.prepare(sql);
};

function hashInt(input) {
  let h = 0;
  const str = String(input);
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function computeStrength(message, id) {
  const len = message.length;
  const base = Math.min(85, 20 + Math.floor((len / 300) * 65));
  const noise = hashInt(id) % 16;
  return Math.max(0, Math.min(100, base + noise));
}

export function createMessage({ createdAt, callsign, origin, message }) {
  const tx = db.transaction(() => {
    const insert = insertMessageStmt.run({
      created_at: createdAt,
      callsign,
      origin,
      message,
      strength: 0
    });
    const id = insert.lastInsertRowid;
    const strength = computeStrength(message, id);
    updateMessageStrengthStmt.run(strength, id);
    return getMessageByIdStmt.get(id);
  });

  return tx();
}

export function listMessages({ limit, offset, query, origin }) {
  const unknownOriginOnly = origin === '__unknown__';
  const hasQuery = Boolean(query);
  const hasOrigin = Boolean(origin) && !unknownOriginOnly;
  const params = {
    limit,
    offset
  };

  if (hasQuery) params.q = `%${query}%`;
  if (hasOrigin) params.origin = `%${origin.toLowerCase()}%`;

  const listStmt = listMessagesStmtFactory({ hasQuery, hasOrigin, unknownOriginOnly });
  const countStmt = hasQuery || hasOrigin || unknownOriginOnly
    ? countMessagesStmtFactory({ hasQuery, hasOrigin, unknownOriginOnly })
    : countMessagesBaseStmt;

  return {
    items: listStmt.all(params),
    total: countStmt.get(params).total
  };
}

export function getMessageById(id) {
  return getMessageByIdStmt.get(id);
}

export function deleteMessage(id) {
  return deleteMessageStmt.run(id).changes > 0;
}

export function reportMessage({ messageId, createdAt, reason }) {
  return insertReportStmt.run({
    message_id: messageId,
    created_at: createdAt,
    reason
  });
}
