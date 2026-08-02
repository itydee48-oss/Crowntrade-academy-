const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken, requireMentor, requireAdmin } = require('../middleware/auth');

// ── CLIENT: BOOK SESSION ────────────────────────────────────────────────────
router.post('/book', authenticateToken, async (req, res) => {
  try {
    const { scheduled_at, contact_method, client_notes, duration_minutes } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'Scheduled time required' });
    const userResult = await query('SELECT mentor_id FROM users WHERE id=$1', [req.user.id]);
    const mentor_id = userResult.rows[0]?.mentor_id;
    if (!mentor_id) return res.status(400).json({ error: 'No mentor assigned yet' });
    const result = await query(`INSERT INTO sessions (mentor_id,client_user_id,scheduled_at,duration_minutes,contact_method,client_notes)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [mentor_id, req.user.id, scheduled_at, duration_minutes||60, contact_method||'whatsapp', client_notes||'']);
    res.json({ session: result.rows[0] });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to book session' }); }
});

// ── CLIENT: MY SESSIONS ─────────────────────────────────────────────────────
router.get('/my-sessions', authenticateToken, async (req, res) => {
  try {
    const result = await query(`SELECT s.*, m.display_name as mentor_name, m.full_name as mentor_full_name,
      m.phone as mentor_phone FROM sessions s
      JOIN mentors m ON s.mentor_id = m.id
      WHERE s.client_user_id=$1 ORDER BY s.scheduled_at DESC`, [req.user.id]);
    res.json({ sessions: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get sessions' }); }
});

// ── CLIENT: CANCEL SESSION ──────────────────────────────────────────────────
router.patch('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    await query('UPDATE sessions SET status=$1 WHERE id=$2 AND client_user_id=$3', ['cancelled', req.params.id, req.user.id]);
    res.json({ message: 'Session cancelled' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to cancel' }); }
});

// ── CLIENT: GET MENTOR AVAILABILITY ─────────────────────────────────────────
router.get('/availability/:mentorId', async (req, res) => {
  try {
    const result = await query('SELECT * FROM mentor_availability WHERE mentor_id=$1 AND is_active=TRUE ORDER BY day_of_week', [req.params.mentorId]);
    res.json({ availability: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get availability' }); }
});

// ── MENTOR: GET CLIENTS ─────────────────────────────────────────────────────
router.get('/mentor/clients', requireMentor, async (req, res) => {
  try {
    const result = await query(`SELECT u.id, u.full_name, u.email, u.phone, u.member_number,
      u.login_streak, u.login_last_date, u.module_streak, u.module_last_date, u.created_at,
      e.course_id, c.title as course_title, e.completed_modules, e.status as enrollment_status,
      (SELECT COUNT(*) FROM sessions s WHERE s.client_user_id=u.id AND s.mentor_id=$1)::int as session_count
      FROM users u
      LEFT JOIN enrollments e ON e.user_id=u.id AND e.status='approved'
      LEFT JOIN courses c ON c.id=e.course_id
      WHERE u.mentor_id=$1 ORDER BY u.created_at DESC`, [req.user.id]);
    res.json({ clients: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get clients' }); }
});

// ── MENTOR: GET SESSIONS ────────────────────────────────────────────────────
router.get('/mentor/sessions', requireMentor, async (req, res) => {
  try {
    const result = await query(`SELECT s.*, u.full_name as client_name, u.email as client_email,
      u.phone as client_phone, u.member_number FROM sessions s
      JOIN users u ON s.client_user_id=u.id
      WHERE s.mentor_id=$1 ORDER BY s.scheduled_at DESC`, [req.user.id]);
    res.json({ sessions: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get sessions' }); }
});

// ── MENTOR: UPDATE SESSION ──────────────────────────────────────────────────
router.patch('/mentor/:id', requireMentor, async (req, res) => {
  try {
    const { status, contact_link, mentor_notes } = req.body;
    await query(`UPDATE sessions SET status=COALESCE($1,status), contact_link=COALESCE($2,contact_link),
      mentor_notes=COALESCE($3,mentor_notes), updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND mentor_id=$5`,
      [status||null, contact_link||null, mentor_notes||null, req.params.id, req.user.id]);
    res.json({ message: 'Session updated' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to update session' }); }
});

// ── MENTOR: SET AVAILABILITY ────────────────────────────────────────────────
router.post('/mentor/availability', requireMentor, async (req, res) => {
  try {
    const { slots } = req.body;
    await query('DELETE FROM mentor_availability WHERE mentor_id=$1', [req.user.id]);
    if (slots && slots.length) {
      for (const slot of slots) {
        await query(`INSERT INTO mentor_availability (mentor_id,day_of_week,start_time,end_time,is_active)
          VALUES ($1,$2,$3,$4,$5)`, [req.user.id, slot.day_of_week, slot.start_time, slot.end_time, true]);
      }
    }
    res.json({ message: `Availability saved — ${slots?.length||0} slots` });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to save availability' }); }
});

// ── MENTOR: REQUEST REASSIGNMENT ────────────────────────────────────────────
router.post('/mentor/reassign', requireMentor, async (req, res) => {
  try {
    const { client_user_id, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    const result = await query(`INSERT INTO mentor_reassignment_requests (mentor_id,client_user_id,reason)
      VALUES ($1,$2,$3) RETURNING *`, [req.user.id, client_user_id, reason]);
    res.json({ request: result.rows[0] });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to submit request' }); }
});

// ── ADMIN: ALL SESSIONS ─────────────────────────────────────────────────────
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT s.*, u.full_name as client_name, u.member_number,
      m.display_name as mentor_name FROM sessions s
      JOIN users u ON s.client_user_id=u.id JOIN mentors m ON s.mentor_id=m.id`;
    const params = [];
    if (status) { sql += ' WHERE s.status=$1'; params.push(status); }
    sql += ' ORDER BY s.scheduled_at DESC LIMIT 100';
    const result = await query(sql, params);
    res.json({ sessions: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get sessions' }); }
});

// ── ADMIN: UPDATE SESSION ────────────────────────────────────────────────────
router.patch('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await query('UPDATE sessions SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [status, req.params.id]);
    res.json({ message: 'Session updated' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to update session' }); }
});

// ── ADMIN: REASSIGNMENT REQUESTS ─────────────────────────────────────────────
router.get('/admin/reassign-requests', requireAdmin, async (req, res) => {
  try {
    const result = await query(`SELECT r.*, u.full_name as client_name, u.member_number,
      m.display_name as mentor_name FROM mentor_reassignment_requests r
      JOIN users u ON r.client_user_id=u.id JOIN mentors m ON r.mentor_id=m.id
      WHERE r.status='pending' ORDER BY r.requested_at DESC`);
    res.json({ requests: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get requests' }); }
});

// ── ADMIN: REVIEW REASSIGNMENT ───────────────────────────────────────────────
router.patch('/admin/reassign/:id', requireAdmin, async (req, res) => {
  try {
    const { status, admin_notes, new_mentor_id } = req.body;
    const reqResult = await query('SELECT * FROM mentor_reassignment_requests WHERE id=$1', [req.params.id]);
    const r = reqResult.rows[0];
    if (!r) return res.status(404).json({ error: 'Request not found' });
    await query(`UPDATE mentor_reassignment_requests SET status=$1,admin_notes=$2,reviewed_at=CURRENT_TIMESTAMP WHERE id=$3`,
      [status, admin_notes||'', req.params.id]);
    if (status === 'approved' && new_mentor_id) {
      await query('UPDATE users SET mentor_id=$1 WHERE id=$2', [new_mentor_id, r.client_user_id]);
    }
    res.json({ message: 'Request reviewed' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to review' }); }
});

module.exports = router;
