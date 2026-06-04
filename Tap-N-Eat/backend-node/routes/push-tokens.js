/**
 * push-tokens.js
 * --------------
 * POST /api/push-tokens  { email, push_token }
 *
 * Saves (or refreshes) an FCM registration token for a parent device.
 * If the same token already exists for this parent it is re-activated;
 * if it belongs to a different email the unique constraint prevents collision.
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const { ensurePushTokensTable } = require('../utils/pushNotification');

// POST /api/push-tokens
router.post('/', async (req, res) => {
  const { email, push_token: pushToken } = req.body;

  // Basic validation
  if (!email || !pushToken) {
    return res.status(400).json({
      success: false,
      message: 'email and push_token are required',
    });
  }

  // Validate FCM token — must be a non-empty string (FCM tokens are long alphanumeric strings)
  if (typeof pushToken !== 'string' || pushToken.trim().length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Invalid push token',
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const conn = await pool.getConnection();
  try {
    // Ensure the table exists (auto-migration)
    await ensurePushTokensTable(conn);

    // Upsert: insert new row or re-activate existing token for this email
    await conn.query(
      `INSERT INTO parent_push_tokens (parent_email, push_token, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE is_active = 1, updated_at = NOW()`,
      [normalizedEmail, pushToken]
    );

    return res.json({ success: true, message: 'Push token saved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
