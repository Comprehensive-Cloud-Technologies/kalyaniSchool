const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const bcrypt  = require('bcryptjs');

async function parentResponse(conn, parent) {
  const [children] = await conn.query(
    `SELECT e.id, e.school_id, e.emp_id AS student_id, e.emp_name AS student_name,
            e.rfid_number,
            COALESCE(NULLIF(e.grade,''), e.shift) AS grade,
            COALESCE(NULLIF(e.division,''), e.site_name) AS division,
            e.wallet_amount, s.school_name, s.logo_url AS school_logo_url
     FROM employees e LEFT JOIN schools s ON s.id=e.school_id
     WHERE LOWER(TRIM(e.parent_email)) = LOWER(TRIM(?))
     ORDER BY e.emp_name ASC`,
    [parent.email]
  );
  const first = children[0];
  return {
    parent: { id: parseInt(parent.id), full_name: parent.full_name, email: parent.email, phone: parent.phone || '' },
    school: first ? { id: first.school_id, name: first.school_name, logo_url: first.school_logo_url || null } : null,
    children,
  };
}

// POST /api/parent-portal?action=login|signup
router.post('/', async (req, res) => {
  const action = req.query.action || '';
  const conn = await pool.getConnection();
  try {
    if (action === 'signup') {
      const { full_name, email, phone, password } = req.body;
      if (!full_name || !email || !password)
        return res.status(400).json({ error: 'full_name, email and password are required' });
      if (password.length < 6)
        return res.status(400).json({ error: 'Password must be at least 6 characters' });

      const normEmail = email.trim().toLowerCase();
      const [existing] = await conn.query(
        "SELECT id, is_active FROM parents WHERE email=? LIMIT 1", [normEmail]
      );
      if (existing.length > 0) {
        if (parseInt(existing[0].is_active) === 1)
          return res.status(409).json({ error: 'An account with this email already exists' });
        // Account was deleted/deactivated — reactivate with new credentials
        const hash = await bcrypt.hash(password, 10);
        await conn.query(
          "UPDATE parents SET full_name=?, phone=?, password_hash=?, is_active=1 WHERE id=?",
          [full_name.trim(), (phone || '').trim(), hash, existing[0].id]
        );
        const reactivated = { id: existing[0].id, full_name: full_name.trim(), email: normEmail, phone: (phone || '').trim() };
        return res.json({ message: 'Account created successfully', data: await parentResponse(conn, reactivated) });
      }

      const hash = await bcrypt.hash(password, 10);
      const [result] = await conn.query(
        "INSERT INTO parents (full_name, email, phone, password_hash, is_active) VALUES (?,?,?,?,1)",
        [full_name.trim(), normEmail, (phone || '').trim(), hash]
      );
      const newParent = { id: result.insertId, full_name: full_name.trim(), email: normEmail, phone: (phone || '').trim() };
      return res.json({ message: 'Account created successfully', data: await parentResponse(conn, newParent) });
    }

    if (action === 'login') {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

      const [rows] = await conn.query(
        "SELECT id, full_name, email, phone, password_hash, is_active FROM parents WHERE email=? LIMIT 1",
        [email.trim().toLowerCase()]
      );
      const parent = rows[0];
      if (!parent || parseInt(parent.is_active) !== 1) return res.status(401).json({ error: 'Invalid email or password' });
      if (!parent.password_hash || !(await bcrypt.compare(password, parent.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });

      return res.json({ message: 'Login successful', data: await parentResponse(conn, parent) });
    }

    if (action === 'recharge') {
      const { email, student_id, amount } = req.body;
      const amt = parseFloat(amount);
      if (!email || !student_id || !amt || amt <= 0) return res.status(400).json({ error: 'email, student_id and valid amount are required' });

      await conn.beginTransaction();
      const [parentRows] = await conn.query("SELECT id, full_name, email, phone, is_active FROM parents WHERE email=? LIMIT 1", [email.trim().toLowerCase()]);
      const parent = parentRows[0];
      if (!parent || parseInt(parent.is_active) !== 1) throw new Error('Parent account not found');

      const [studentRows] = await conn.query(
        "SELECT id, school_id, emp_id, emp_name, rfid_number, wallet_amount FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1",
        [parseInt(student_id), email.trim().toLowerCase()]
      );
      const student = studentRows[0];
      if (!student) throw new Error('Student not found for this parent');

      const previousBalance = parseFloat(student.wallet_amount || 0);
      const newBalance = previousBalance + amt;
      await conn.query("UPDATE employees SET wallet_amount=? WHERE id=?", [newBalance, parseInt(student_id)]);

      const dateObj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      await conn.query(
        `INSERT INTO transactions
           (employee_id, school_id, rfid_number, emp_id, emp_name, transaction_type, order_status,
            meal_category, amount, previous_balance, new_balance, transaction_time, transaction_date)
         VALUES (?, ?, ?, ?, ?, 'recharge', 'Completed', 'Wallet Recharge', ?, ?, ?, ?, ?)`,
        [parseInt(student_id), student.school_id ? parseInt(student.school_id) : null,
         student.rfid_number, student.emp_id, student.emp_name,
         amt, previousBalance, newBalance,
         dateObj.toTimeString().split(' ')[0], dateObj.toISOString().split('T')[0]]
      );
      await conn.commit();

      const [freshParent] = await conn.query("SELECT id, full_name, email, phone FROM parents WHERE id=? LIMIT 1", [parseInt(parent.id)]);
      return res.json({
        message: 'Wallet recharged successfully',
        student: { id: parseInt(student_id), student_name: student.emp_name, student_id: student.emp_id, wallet_amount: newBalance },
        data: await parentResponse(conn, freshParent[0]),
      });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/parent-portal?action=profile&email=X  or  ?action=transactions&email=X&student_id=Y
router.get('/', async (req, res) => {
  const action = req.query.action || '';
  const conn = await pool.getConnection();
  try {
    if (action === 'profile') {
      const email = (req.query.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'email is required' });
      const [rows] = await conn.query("SELECT id, full_name, email, phone, is_active FROM parents WHERE email=? LIMIT 1", [email]);
      const parent = rows[0];
      if (!parent || parseInt(parent.is_active) !== 1) return res.status(404).json({ error: 'Parent not found' });
      return res.json(await parentResponse(conn, parent));
    }

    if (action === 'subscriptions') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      if (!email || !studentId) return res.status(400).json({ error: 'email and student_id are required' });

      const [ownership] = await conn.query(
        "SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1",
        [studentId, email]
      );
      if (ownership.length === 0) return res.status(404).json({ error: 'Student not found for this parent' });

      const [subscriptions] = await conn.query(
        `SELECT id, meal_type_id, meal_type_name, month, year, grade, amount_paid, status, subscribed_at
         FROM meal_subscriptions
         WHERE student_id = ?
         ORDER BY year DESC, month DESC, meal_type_name ASC`,
        [studentId]
      ).catch(() => [[]]);
      return res.json({ student: ownership[0], subscriptions });
    }

    if (action === 'canteen-log') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit || 30)));
      if (!email || !studentId) return res.status(400).json({ error: 'email and student_id are required' });

      const [ownership] = await conn.query(
        "SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1",
        [studentId, email]
      );
      if (ownership.length === 0) return res.status(404).json({ error: 'Student not found for this parent' });

      const [log] = await conn.query(
        `SELECT id, meal_type_name, access_status, deny_reason, access_date, access_time, created_at
         FROM canteen_access_log
         WHERE student_id = ?
         ORDER BY access_date DESC, access_time DESC
         LIMIT ?`,
        [studentId, limit]
      ).catch(() => [[]]);
      return res.json({ student: ownership[0], canteen_log: log });
    }

    if (action === 'transactions') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      const limit     = Math.min(200, Math.max(1, parseInt(req.query.limit || 50)));
      if (!email || !studentId) return res.status(400).json({ error: 'email and student_id are required' });

      const [ownership] = await conn.query(
        "SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1",
        [studentId, email]
      );
      if (ownership.length === 0) return res.status(404).json({ error: 'Student not found for this parent' });

      const [transactions] = await conn.query(
        `SELECT id, transaction_type, order_status, meal_category, amount, previous_balance, new_balance,
                transaction_date, transaction_time, created_at
         FROM transactions WHERE employee_id=?
         ORDER BY transaction_date DESC, transaction_time DESC, created_at DESC LIMIT ?`,
        [studentId, limit]
      );
      return res.json({ student: ownership[0], transactions });
    }

    if (action === 'payment-history') {
      const email     = (req.query.email || '').trim().toLowerCase();
      const studentId = parseInt(req.query.student_id || 0);
      const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit || 50)));
      if (!email || !studentId) return res.status(400).json({ error: 'email and student_id are required' });

      const [ownership] = await conn.query(
        "SELECT id, emp_name FROM employees WHERE id=? AND LOWER(TRIM(parent_email))=LOWER(TRIM(?)) LIMIT 1",
        [studentId, email]
      );
      if (ownership.length === 0) return res.status(404).json({ error: 'Student not found for this parent' });

      const [payments] = await conn.query(
        `SELECT id, razorpay_order_id, razorpay_payment_id, meal_type_name, payment_for,
                payment_months, payment_year, sub_total, convenience_fee, total_paid,
                payment_status, created_at
         FROM wallet_recharge_payments
         WHERE student_id=?
         ORDER BY created_at DESC LIMIT ?`,
        [studentId, limit]
      ).catch(() => [[]]);
      return res.json({ student: ownership[0], payments });
    }

    res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
