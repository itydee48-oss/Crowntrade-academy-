const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// ── GET MENTOR AVAILABILITY (for booking calendar) ─────────────────────────
router.get('/availability/:mentorId', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM mentor_availability WHERE mentor_id=$1 AND is_active=TRUE ORDER BY day_of_week,start_time',
      [req.params.mentorId]
    );
    res.json({ availability: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get availability' }); }
});

// ── BOOK A SESSION (client) ────────────────────────────────────────────────
router.post('/book', authenticateToken, async (req, res) => {
  try {
    const { scheduled_at, duration_minutes, contact_method, client_notes } = req.body;
    if (!scheduled_at || !contact_method) return res.status(400).json({ error: 'scheduled_at and contact_method required' });

    // Get assigned mentor
    const userResult = await query('SELECT mentor_id,has_mentorship FROM users WHERE id=$1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user.has_mentorship) return res.status(403).json({ error: 'Mentorship not unlocked' });
    if (!user.mentor_id) return res.status(400).json({ error: 'No mentor assigned yet. Contact admin.' });

    // Check for conflicting booking
    const conflict = await query(
      `SELECT id FROM sessions WHERE mentor_id=$1 AND scheduled_at=$2 AND status NOT IN ('cancelled')`,
      [user.mentor_id, scheduled_at]
    );
    if (conflict.rows.length > 0) return res.status(409).json({ error: 'This slot is already booked. Please choose another time.' });

    const result = await query(`
      INSERT INTO sessions (mentor_id,client_user_id,scheduled_at,duration_minutes,contact_method,client_notes)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
    `, [user.mentor_id, req.user.id, scheduled_at, duration_minutes || 60, contact_method, client_notes || null]);

    res.status(201).json({ message: 'Session booked! Your mentor will confirm shortly.', session_id: result.rows[0].id });
  } catch (err) {
    console.error('Book session error:', err);
    res.status(500).json({ error: 'Failed to book session' });
  }
});

// ── GET CLIENT'S SESSIONS ──────────────────────────────────────────────────
router.get('/my-sessions', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*,m.display_name as mentor_display_name,m.avatar_url as mentor_avatar
      FROM sessions s JOIN mentors m ON s.mentor_id=m.id
      WHERE s.client_user_id=$1 ORDER BY s.scheduled_at DESC
    `, [req.user.id]);

    // Only reveal contact_link if session is confirmed
    const sessions = result.rows.map(s => ({
      ...s,
      contact_link: s.status === 'confirmed' ? s.contact_link : null
    }));
    res.json({ sessions });
  } catch (err) { res.status(500).json({ error: 'Failed to get sessions' }); }
});

// ── CANCEL SESSION (client) ────────────────────────────────────────────────
router.patch('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM sessions WHERE id=$1', [req.params.id]);
    const session = result.rows[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.client_user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    if (['completed','cancelled'].includes(session.status)) return res.status(400).json({ error: 'Cannot cancel this session' });

    await query(`UPDATE sessions SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Session cancelled' });
  } catch (err) { res.status(500).json({ error: 'Failed to cancel session' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MENTOR ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// Mentor auth middleware — checks mentor JWT (we'll use type:'mentor' in token)
function requireMentor(req, res, next) {
  if (!req.user || req.user.type !== 'mentor') return res.status(403).json({ error: 'Mentor access required' });
  next();
}

// ── GET MENTOR'S SESSIONS ──────────────────────────────────────────────────
router.get('/mentor/sessions', authenticateToken, requireMentor, async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*,u.full_name as client_name,u.email as client_email,u.member_number,u.phone as client_phone
      FROM sessions s JOIN users u ON s.client_user_id=u.id
      WHERE s.mentor_id=$1 ORDER BY s.scheduled_at DESC
    `, [req.user.id]);
    res.json({ sessions: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get sessions' }); }
});

// ── CONFIRM / UPDATE SESSION (mentor) ─────────────────────────────────────
router.patch('/mentor/:id', authenticateToken, requireMentor, async (req, res) => {
  try {
    const { status, contact_link, mentor_notes } = req.body;
    const result = await query('SELECT * FROM sessions WHERE id=$1 AND mentor_id=$2', [req.params.id, req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Session not found' });

    await query(`UPDATE sessions SET status=COALESCE($1,status),contact_link=COALESCE($2,contact_link),mentor_notes=COALESCE($3,mentor_notes),updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [status||null, contact_link||null, mentor_notes||null, req.params.id]);
    res.json({ message: 'Session updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update session' }); }
});

// ── SET AVAILABILITY (mentor) ──────────────────────────────────────────────
router.post('/mentor/availability', authenticateToken, requireMentor, async (req, res) => {
  try {
    const { slots } = req.body; // array of {day_of_week, start_time, end_time, is_active}
    if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots must be an array' });

    // Replace all availability for this mentor
    await query('DELETE FROM mentor_availability WHERE mentor_id=$1', [req.user.id]);
    for (const slot of slots) {
      await query(`INSERT INTO mentor_availability (mentor_id,day_of_week,start_time,end_time,is_active) VALUES ($1,$2,$3,$4,$5)`,
        [req.user.id, slot.day_of_week, slot.start_time, slot.end_time, slot.is_active !== false]);
    }
    res.json({ message: 'Availability updated', count: slots.length });
  } catch (err) { res.status(500).json({ error: 'Failed to update availability' }); }
});

// ── GET MENTOR'S CLIENTS ───────────────────────────────────────────────────
router.get('/mentor/clients', authenticateToken, requireMentor, async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id,u.full_name,u.email,u.member_number,u.phone,u.login_streak,u.module_streak,u.login_last_date,u.module_last_date,u.status,
        e.status as enrollment_status,e.completed_modules,c.title as course_title,c.id as course_id,
        (SELECT COUNT(*)::int FROM sessions s WHERE s.client_user_id=u.id AND s.mentor_id=$1) as session_count,
        (SELECT MAX(s.scheduled_at) FROM sessions s WHERE s.client_user_id=u.id AND s.mentor_id=$1 AND s.status='completed') as last_session
      FROM users u
      LEFT JOIN enrollments e ON e.user_id=u.id AND e.status='approved'
      LEFT JOIN courses c ON c.id=e.course_id
      WHERE u.mentor_id=$1
      ORDER BY u.full_name ASC
    `, [req.user.id]);

    const clients = result.rows.map(c => ({
      ...c,
      completed_modules: JSON.parse(c.completed_modules || '[]')
    }));
    res.json({ clients });
  } catch (err) { res.status(500).json({ error: 'Failed to get clients' }); }
});

// ── REQUEST REASSIGNMENT (mentor) ──────────────────────────────────────────
router.post('/mentor/reassign', authenticateToken, requireMentor, async (req, res) => {
  try {
    const { client_user_id, reason } = req.body;
    if (!client_user_id || !reason) return res.status(400).json({ error: 'client_user_id and reason required' });

    const clientCheck = await query('SELECT id FROM users WHERE id=$1 AND mentor_id=$2', [client_user_id, req.user.id]);
    if (!clientCheck.rows[0]) return res.status(403).json({ error: 'This client is not assigned to you' });

    const result = await query(`INSERT INTO mentor_reassignment_requests (mentor_id,client_user_id,reason) VALUES ($1,$2,$3) RETURNING id`,
      [req.user.id, client_user_id, reason]);
    res.status(201).json({ message: 'Reassignment request submitted to admin.', id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to submit request' }); }
});

// ── GET MENTOR'S REASSIGNMENT REQUESTS ────────────────────────────────────
router.get('/mentor/reassign-requests', authenticateToken, requireMentor, async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*,u.full_name as client_name,u.member_number
      FROM mentor_reassignment_requests r JOIN users u ON r.client_user_id=u.id
      WHERE r.mentor_id=$1 ORDER BY r.requested_at DESC
    `, [req.user.id]);
    res.json({ requests: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get requests' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN SESSION ROUTES
// ══════════════════════════════════════════════════════════════════════════════
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const { status, mentor_id } = req.query;
    let sql = `SELECT s.*,u.full_name as client_name,u.member_number,m.display_name as mentor_name FROM sessions s JOIN users u ON s.client_user_id=u.id JOIN mentors m ON s.mentor_id=m.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND s.status=$${params.length}`; }
    if (mentor_id) { params.push(mentor_id); sql += ` AND s.mentor_id=$${params.length}`; }
    sql += ' ORDER BY s.scheduled_at DESC';
    const result = await query(sql, params);
    res.json({ sessions: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get sessions' }); }
});

router.patch('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    await query(`UPDATE sessions SET status=COALESCE($1,status),updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [status||null, req.params.id]);
    res.json({ message: 'Session updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update session' }); }
});

router.get('/admin/reassign-requests', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*,u.full_name as client_name,u.member_number,m.full_name as mentor_name
      FROM mentor_reassignment_requests r JOIN users u ON r.client_user_id=u.id JOIN mentors m ON r.mentor_id=m.id
      WHERE r.status='pending' ORDER BY r.requested_at ASC
    `);
    res.json({ requests: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get requests' }); }
});

router.patch('/admin/reassign/:id', requireAdmin, async (req, res) => {
  try {
    const { status, admin_notes, new_mentor_id } = req.body;
    const rResult = await query('SELECT * FROM mentor_reassignment_requests WHERE id=$1', [req.params.id]);
    const r = rResult.rows[0];
    if (!r) return res.status(404).json({ error: 'Request not found' });

    await query(`UPDATE mentor_reassignment_requests SET status=$1,admin_notes=$2,reviewed_at=CURRENT_TIMESTAMP WHERE id=$3`,
      [status, admin_notes||null, req.params.id]);

    if (status === 'approved' && new_mentor_id) {
      await query('UPDATE users SET mentor_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2', [new_mentor_id, r.client_user_id]);
    }
    res.json({ message: 'Request reviewed' });
  } catch (err) { res.status(500).json({ error: 'Failed to review request' }); }
});

module.exports = router;
