/**
 * pushNotification.js
 * -------------------
 * Backend helper for push notifications via Firebase Admin SDK (FCM V1).
 * Stats appear in Firebase Console → Cloud Messaging.
 *
 * Exported functions:
 *  - ensurePushTokensTable(conn)              — auto-creates the DB table
 *  - getTokensByEmail(parentEmail)            — returns active tokens for a parent
 *  - getTokensByStudentId(studentId)          — returns tokens via student→parent lookup
 *  - sendPushNotifications(tokens, ...)       — sends via FCM V1
 *  - sendNotificationToParentByEmail(...)     — convenience: lookup + send
 *  - sendNotificationToParentByStudentId(...) — convenience: lookup + send
 */

const admin = require('firebase-admin');
const pool  = require('../config/database');

// ── Firebase Admin initialisation (singleton) ─────────────────────────────────

let messaging = null;

if (!admin.apps.length) {
  try {
    const serviceAccount = require('../firebase-service-account.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    messaging = admin.messaging();
  } catch (e) {
    console.warn('[PushNotification] firebase-service-account.json not found — push notifications disabled');
  }
} else {
  messaging = admin.messaging();
}

// ── Table management ──────────────────────────────────────────────────────────

/**
 * Creates the parent_push_tokens table if it does not exist.
 * Also called by the push-tokens route, so it is safe to call multiple times.
 *
 * @param {import('mysql2').Connection} conn
 */
async function ensurePushTokensTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS parent_push_tokens (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      parent_email VARCHAR(191) NOT NULL,
      push_token   VARCHAR(255) NOT NULL,
      is_active    TINYINT(1)  NOT NULL DEFAULT 1,
      created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_parent_token (parent_email, push_token),
      INDEX idx_parent_email (parent_email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ── Token retrieval ───────────────────────────────────────────────────────────

/**
 * Returns all active Expo Push Tokens registered for a parent email.
 *
 * @param {string} parentEmail
 * @returns {Promise<string[]>}
 */
async function getTokensByEmail(parentEmail) {
  if (!parentEmail) return [];
  const conn = await pool.getConnection();
  try {
    await ensurePushTokensTable(conn);
    const [rows] = await conn.query(
      'SELECT push_token FROM parent_push_tokens WHERE LOWER(TRIM(parent_email)) = ? AND is_active = 1',
      [parentEmail.trim().toLowerCase()]
    );
    return rows.map((r) => r.push_token);
  } catch {
    return [];
  } finally {
    conn.release();
  }
}

/**
 * Returns all active Expo Push Tokens for the parent of a given student.
 * Looks up parent_email from the employees table using the student ID.
 *
 * @param {number|string} studentId - The employee/student ID
 * @returns {Promise<string[]>}
 */
async function getTokensByStudentId(studentId) {
  if (!studentId) return [];
  const conn = await pool.getConnection();
  try {
    await ensurePushTokensTable(conn);
    const [empRows] = await conn.query(
      'SELECT parent_email FROM employees WHERE id = ? LIMIT 1',
      [studentId]
    );
    if (empRows.length === 0 || !empRows[0].parent_email) return [];

    const parentEmail = empRows[0].parent_email.trim().toLowerCase();
    const [rows] = await conn.query(
      'SELECT push_token FROM parent_push_tokens WHERE LOWER(TRIM(parent_email)) = ? AND is_active = 1',
      [parentEmail]
    );
    return rows.map((r) => r.push_token);
  } catch {
    return [];
  } finally {
    conn.release();
  }
}

// ── Token lifecycle ───────────────────────────────────────────────────────────

async function deactivateToken(pushToken) {
  try {
    await pool.query(
      'UPDATE parent_push_tokens SET is_active = 0 WHERE push_token = ?',
      [pushToken]
    );
  } catch {
    // Non-fatal; ignore
  }
}

// ── Sending ───────────────────────────────────────────────────────────────────

/**
 * Sends push notifications to one or more FCM registration tokens via
 * Firebase Admin SDK (FCM V1). Stats appear in Firebase Console.
 *
 * @param {string[]} tokens - Array of FCM registration token strings
 * @param {string}   title
 * @param {string}   body
 * @param {Object}   data   - Data payload for navigation on tap (string values only)
 */
async function sendPushNotifications(tokens, title, body, data = {}) {
  if (!tokens || tokens.length === 0) return;
  if (!messaging) return; // Firebase not configured — skip silently

  // FCM V1 requires all data values to be strings
  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  const sendPromises = tokens.map(async (token) => {
    try {
      await messaging.send({
        token,
        notification: { title, body },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
        data: stringData,
      });
      console.log(`[FCM] Sent to token ...${token.slice(-10)}`);
    } catch (err) {
      const code = err.errorInfo?.code || err.code || '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        await deactivateToken(token);
        console.log(`[FCM] Deactivated invalid token ...${token.slice(-10)}`);
      } else {
        console.error(`[FCM] Send error for token ...${token.slice(-10)}:`, code);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Looks up push tokens by parent email and sends a notification.
 * Errors are fully swallowed — this must never break the calling route.
 *
 * @param {string} parentEmail
 * @param {string} title
 * @param {string} body
 * @param {Object} data
 */
async function sendNotificationToParentByEmail(parentEmail, title, body, data = {}) {
  try {
    const tokens = await getTokensByEmail(parentEmail);
    if (tokens.length > 0) {
      await sendPushNotifications(tokens, title, body, data);
    }
  } catch {
    // Non-fatal — never propagate push errors to the caller
  }
}

/**
 * Looks up push tokens by student ID (via parent_email on employees table)
 * and sends a notification to that student's parent.
 * Errors are fully swallowed.
 *
 * @param {number|string} studentId
 * @param {string} title
 * @param {string} body
 * @param {Object} data
 */
async function sendNotificationToParentByStudentId(studentId, title, body, data = {}) {
  try {
    const tokens = await getTokensByStudentId(studentId);
    if (tokens.length > 0) {
      await sendPushNotifications(tokens, title, body, data);
    }
  } catch {
    // Non-fatal — never propagate push errors to the caller
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  ensurePushTokensTable,
  getTokensByEmail,
  getTokensByStudentId,
  sendPushNotifications,
  sendNotificationToParentByEmail,
  sendNotificationToParentByStudentId,
};
