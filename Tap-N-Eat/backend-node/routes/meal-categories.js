const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

async function ensureTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS meal_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    school_id INT NULL,
    category_name VARCHAR(80) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cat (school_id, category_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// GET /api/meal-categories[?school_id=X]
router.get('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    const schoolId = req.query.school_id && !isNaN(req.query.school_id) ? parseInt(req.query.school_id) : null;
    let sql = 'SELECT * FROM meal_categories WHERE is_active=1';
    const params = [];
    if (schoolId) { sql += ' AND (school_id=? OR school_id IS NULL)'; params.push(schoolId); }
    sql += ' ORDER BY start_time ASC';
    const [rows] = await conn.query(sql, params);
    res.json({ categories: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// POST /api/meal-categories  { school_id, category_name, start_time, end_time }
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTable(conn);
    const schoolId     = req.body.school_id ? parseInt(req.body.school_id) : null;
    const categoryName = (req.body.category_name || '').trim();
    const startTime    = req.body.start_time || null;
    const endTime      = req.body.end_time   || null;

    if (!categoryName || !startTime || !endTime) {
      return res.status(400).json({ error: 'category_name, start_time, and end_time are required' });
    }

    const [result] = await conn.query(
      `INSERT INTO meal_categories (school_id, category_name, start_time, end_time)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_time=VALUES(start_time), end_time=VALUES(end_time), is_active=1, updated_at=NOW()`,
      [schoolId, categoryName, startTime, endTime]
    );
    res.json({ message: 'Meal category saved', id: result.insertId || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/meal-categories?id=X
router.delete('/', async (req, res) => {
  const id = parseInt(req.query.id || 0);
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    await pool.query('UPDATE meal_categories SET is_active=0 WHERE id=?', [id]);
    res.json({ message: 'Meal category deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/meal-categories  { id, category_name, start_time, end_time }
router.put('/', async (req, res) => {
  const id           = parseInt(req.body.id || 0);
  const categoryName = (req.body.category_name || '').trim();
  const startTime    = req.body.start_time || null;
  const endTime      = req.body.end_time   || null;
  if (!id || !categoryName || !startTime || !endTime)
    return res.status(400).json({ error: 'id, category_name, start_time, and end_time are required' });
  try {
    await pool.query(
      'UPDATE meal_categories SET category_name=?, start_time=?, end_time=?, updated_at=NOW() WHERE id=?',
      [categoryName, startTime, endTime, id]
    );
    res.json({ message: 'Meal category updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
