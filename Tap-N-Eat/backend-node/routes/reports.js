const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// GET /api/reports?type=razorpay|tuckshop|deductions&school_id=X&from=Y&to=Z&limit=N
router.get('/', async (req, res) => {
  const type     = req.query.type     || 'razorpay';
  const schoolId = req.query.school_id && !isNaN(req.query.school_id) ? parseInt(req.query.school_id) : null;
  const from     = req.query.from     || null;
  const to       = req.query.to       || null;
  const limit    = Math.min(parseInt(req.query.limit || 200), 1000);

  const conn = await pool.getConnection();
  try {
    if (type === 'razorpay') {
      await conn.query(`CREATE TABLE IF NOT EXISTS wallet_recharge_payments (
        id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, school_id INT NULL,
        razorpay_order_id VARCHAR(64) NOT NULL, razorpay_payment_id VARCHAR(64) NOT NULL,
        meal_type_id INT NULL, meal_type_name VARCHAR(80) NULL,
        payment_for VARCHAR(20) NOT NULL DEFAULT 'Canteen', payment_months TEXT NULL,
        payment_year SMALLINT NOT NULL, sub_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        convenience_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00, total_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        amount_credited DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        payment_status VARCHAR(20) NOT NULL DEFAULT 'Completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_razorpay_payment (razorpay_payment_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      let q = `SELECT p.id, p.razorpay_order_id, p.razorpay_payment_id, p.payment_for, p.meal_type_name,
                      p.payment_months, p.payment_year, p.sub_total, p.convenience_fee, p.total_paid,
                      p.amount_credited, p.payment_status, p.created_at,
                      e.emp_name AS student_name, e.emp_id AS student_id_no, e.rfid_number,
                      e.grade, e.division, e.parent_email, par.full_name AS parent_name
               FROM wallet_recharge_payments p
               LEFT JOIN employees e ON e.id=p.student_id
               LEFT JOIN parents par ON LOWER(TRIM(par.email))=LOWER(TRIM(e.parent_email))
               WHERE 1=1`;
      const params = [];
      if (schoolId) { q += ' AND p.school_id=?'; params.push(schoolId); }
      if (from)     { q += ' AND DATE(p.created_at)>=?'; params.push(from); }
      if (to)       { q += ' AND DATE(p.created_at)<=?'; params.push(to); }
      q += ' ORDER BY p.created_at DESC LIMIT ?';
      params.push(limit);

      const [rows] = await conn.query(q, params);
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      for (const r of rows) {
        if (r.payment_months) {
          try {
            const decoded = JSON.parse(r.payment_months);
            if (Array.isArray(decoded)) r.payment_months_labels = decoded.map(m => monthNames[m - 1] || m).join(', ');
          } catch (e) {}
        }
      }
      const totalPaid     = rows.reduce((s, r) => s + parseFloat(r.total_paid || 0), 0);
      const totalCredited = rows.reduce((s, r) => s + parseFloat(r.amount_credited || 0), 0);
      return res.json({ status: 'success', type: 'razorpay', count: rows.length, totals: { total_paid: Math.round(totalPaid * 100) / 100, total_credited: Math.round(totalCredited * 100) / 100 }, payments: rows });
    }

    if (type === 'tuckshop') {
      let q = `SELECT t.id AS transaction_id, t.emp_name AS student_name, t.emp_id AS student_id_no,
                      t.rfid_number, t.amount AS total_amount, t.previous_balance, t.new_balance,
                      t.transaction_date, t.transaction_time, t.created_at
               FROM transactions t WHERE t.transaction_type='tuckshop'`;
      const params = [];
      if (schoolId) { q += ' AND t.school_id=?'; params.push(schoolId); }
      if (from)     { q += ' AND t.transaction_date>=?'; params.push(from); }
      if (to)       { q += ' AND t.transaction_date<=?'; params.push(to); }
      q += ' ORDER BY t.transaction_date DESC, t.transaction_time DESC LIMIT ?';
      params.push(limit);

      const [sales] = await conn.query(q, params);
      if (sales.length > 0) {
        const ids = sales.map(s => parseInt(s.transaction_id));
        const [lines] = await conn.query(`SELECT * FROM tuckshop_sale_items WHERE transaction_id IN (${ids.join(',')}) `);
        const byTxn = {};
        for (const l of lines) { const k = parseInt(l.transaction_id); byTxn[k] = byTxn[k] || []; byTxn[k].push(l); }
        for (const s of sales) s.items = byTxn[parseInt(s.transaction_id)] || [];
      }
      return res.json({ status: 'success', type: 'tuckshop', count: sales.length, sales });
    }

    if (type === 'deductions') {
      let q = `SELECT t.id, t.emp_name AS student_name, t.emp_id AS student_id_no, t.rfid_number,
                      t.meal_category, t.amount, t.previous_balance, t.new_balance,
                      t.transaction_date, t.transaction_time, t.order_status
               FROM transactions t WHERE t.transaction_type='deduction'`;
      const params = [];
      if (schoolId) { q += ' AND t.school_id=?'; params.push(schoolId); }
      if (from)     { q += ' AND t.transaction_date>=?'; params.push(from); }
      if (to)       { q += ' AND t.transaction_date<=?'; params.push(to); }
      q += ' ORDER BY t.transaction_date DESC, t.transaction_time DESC LIMIT ?';
      params.push(limit);

      const [rows] = await conn.query(q, params);
      return res.json({ status: 'success', type: 'deductions', count: rows.length, transactions: rows });
    }

    res.status(400).json({ status: 'error', message: 'Invalid report type. Use razorpay, tuckshop, or deductions.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/reports?type=razorpay|tuckshop|deductions&id=X
router.delete('/', async (req, res) => {
  const type = req.query.type || 'razorpay';
  const id   = parseInt(req.query.id || 0);
  if (!id) return res.status(400).json({ status: 'error', message: 'id is required' });
  try {
    if (type === 'razorpay') {
      await pool.query('DELETE FROM wallet_recharge_payments WHERE id=?', [id]);
    } else if (type === 'tuckshop' || type === 'deductions') {
      await pool.query('DELETE FROM transactions WHERE id=?', [id]);
    } else {
      return res.status(400).json({ status: 'error', message: 'Invalid type' });
    }
    res.json({ status: 'success', message: 'Record deleted' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
