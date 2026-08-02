const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { requireAdmin, generateToken } = require('../middleware/auth');

router.use(requireAdmin);

// STATS
router.get('/stats', async (req, res) => {
  try {
    const [users, ment, ref, enr] = await Promise.all([
      query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=$1 THEN 1 END) as active FROM users', ['active']),
      query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=$1 THEN 1 END) as pending, COUNT(CASE WHEN status=$2 THEN 1 END) as approved, COUNT(CASE WHEN status=$3 THEN 1 END) as rejected FROM mentorship_applications', ['pending','approved','rejected']),
      query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=$1 THEN 1 END) as pending, COUNT(CASE WHEN status=$2 THEN 1 END) as approved, COUNT(CASE WHEN status=$3 THEN 1 END) as rejected FROM referral_applications', ['pending','approved','rejected']),
      query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=$1 THEN 1 END) as pending, COUNT(CASE WHEN status=$2 THEN 1 END) as approved FROM enrollments', ['pending','approved'])
    ]);
    res.json({ stats: {
      users: users.rows[0],
      mentorship: ment.rows[0],
      referral: ref.rows[0],
      enrollments: enr.rows[0]
    }});
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get stats' }); }
});

// MENTORSHIP APPS
router.get('/mentorship', async (req, res) => {
  try {
    const { status, page=1, limit=50 } = req.query;
    let sql = `SELECT ma.*,u.member_number FROM mentorship_applications ma LEFT JOIN users u ON ma.user_id=u.id`;
    const params = [];
    if (status) { sql += ' WHERE ma.status=$1'; params.push(status); }
    sql += ` ORDER BY ma.submitted_at DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;
    const r = await query(sql, params);
    res.json({ applications: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get applications' }); }
});

router.patch('/mentorship/:id', async (req, res) => {
  try {
    const { status, admin_notes, payment_status } = req.body;
    await query(`UPDATE mentorship_applications SET status=COALESCE($1,status),
      admin_notes=COALESCE($2,admin_notes), payment_status=COALESCE($3,payment_status),
      reviewed_at=CURRENT_TIMESTAMP WHERE id=$4`, [status||null, admin_notes||null, payment_status||null, req.params.id]);
    if (status === 'approved') {
      const r = await query('SELECT user_id FROM mentorship_applications WHERE id=$1', [req.params.id]);
      if (r.rows[0]) await query('UPDATE users SET has_mentorship=TRUE WHERE id=$1', [r.rows[0].user_id]);
    }
    res.json({ message: 'Application updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update' }); }
});

// REFERRAL APPS
router.get('/referral', async (req, res) => {
  try {
    const { status, page=1, limit=50 } = req.query;
    let sql = `SELECT ra.*,u.member_number,u.referral_code FROM referral_applications ra LEFT JOIN users u ON ra.user_id=u.id`;
    const params = [];
    if (status) { sql += ' WHERE ra.status=$1'; params.push(status); }
    sql += ` ORDER BY ra.submitted_at DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;
    const r = await query(sql, params);
    res.json({ applications: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get applications' }); }
});

router.patch('/referral/:id', async (req, res) => {
  try {
    const { status, admin_notes, payment_status } = req.body;
    await query(`UPDATE referral_applications SET status=COALESCE($1,status),
      admin_notes=COALESCE($2,admin_notes), payment_status=COALESCE($3,payment_status),
      reviewed_at=CURRENT_TIMESTAMP WHERE id=$4`, [status||null, admin_notes||null, payment_status||null, req.params.id]);
    if (status === 'approved') {
      const r = await query('SELECT user_id FROM referral_applications WHERE id=$1', [req.params.id]);
      if (r.rows[0]) await query('UPDATE users SET has_partner_status=TRUE WHERE id=$1', [r.rows[0].user_id]);
    }
    res.json({ message: 'Application updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update' }); }
});

// ENROLLMENTS
router.get('/enrollments', async (req, res) => {
  try {
    const { status, page=1, limit=50 } = req.query;
    let sql = `SELECT e.*,c.title as course_title,u.member_number FROM enrollments e
      JOIN courses c ON e.course_id=c.id JOIN users u ON e.user_id=u.id`;
    const params = [];
    if (status) { sql += ' WHERE e.status=$1'; params.push(status); }
    sql += ` ORDER BY e.submitted_at DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;
    const r = await query(sql, params);
    res.json({ enrollments: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get enrollments' }); }
});

router.patch('/enrollments/:id', async (req, res) => {
  try {
    const { status, admin_notes, payment_status } = req.body;
    await query(`UPDATE enrollments SET status=COALESCE($1,status),
      payment_status=COALESCE($2,payment_status), reviewed_at=CURRENT_TIMESTAMP WHERE id=$3`,
      [status||null, payment_status||null, req.params.id]);
    if (status === 'approved') {
      const r = await query(`SELECT e.user_id,c.is_flagship FROM enrollments e
        JOIN courses c ON e.course_id=c.id WHERE e.id=$1`, [req.params.id]);
      if (r.rows[0]?.is_flagship) await query('UPDATE users SET has_mentorship=TRUE WHERE id=$1', [r.rows[0].user_id]);
    }
    res.json({ message: 'Enrollment updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update' }); }
});

// USERS
router.get('/users', async (req, res) => {
  try {
    const r = await query(`SELECT id,full_name,email,phone,member_number,has_mentorship,has_partner_status,
      mentor_id,partner_tier,status,login_streak,module_streak,created_at FROM users ORDER BY created_at DESC`);
    res.json({ users: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get users' }); }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const { status, mentor_id } = req.body;
    if (mentor_id !== undefined) {
      await query('UPDATE users SET mentor_id=$1 WHERE id=$2', [mentor_id||null, req.params.id]);
    }
    if (status !== undefined) {
      await query('UPDATE users SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [status, req.params.id]);
    }
    res.json({ message: 'User updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update user' }); }
});

// MENTOR MANAGEMENT
router.get('/mentor-list', async (req, res) => {
  try {
    const r = await query(`SELECT m.*, COUNT(DISTINCT u.id)::int as client_count
      FROM mentors m LEFT JOIN users u ON u.mentor_id=m.id GROUP BY m.id ORDER BY m.created_at DESC`);
    res.json({ mentors: r.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get mentors' }); }
});

router.post('/mentor/create', async (req, res) => {
  try {
    const { full_name, display_name, email, phone, password } = req.body;
    if (!full_name||!email||!password) return res.status(400).json({ error: 'Name, email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const exists = await query('SELECT id FROM mentors WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Mentor with this email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const r = await query(`INSERT INTO mentors (full_name,display_name,email,phone,password_hash,status)
      VALUES ($1,$2,$3,$4,$5,'active') RETURNING id,full_name,display_name,email,phone,status`,
      [full_name, display_name||full_name, email.toLowerCase(), phone||'', hash]);
    res.json({ message: 'Mentor created', mentor: r.rows[0] });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to create mentor' }); }
});

router.patch('/mentor/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active','suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await query('UPDATE mentors SET status=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ message: 'Mentor status updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update mentor' }); }
});

// WITHDRAWALS
router.get('/withdrawals', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT w.*,u.full_name,u.email,u.member_number,u.partner_tier as tier
      FROM withdrawal_requests w JOIN users u ON w.user_id=u.id`;
    const params = [];
    if (status) { sql += ' WHERE w.status=$1'; params.push(status); }
    sql += ' ORDER BY w.requested_at DESC';
    const r = await query(sql, params);
    res.json({ withdrawals: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get withdrawals' }); }
});

router.patch('/withdrawals/:id', async (req, res) => {
  try {
    const { status, mpesa_code, admin_notes } = req.body;
    await query(`UPDATE withdrawal_requests SET status=$1, mpesa_code=COALESCE($2,mpesa_code),
      admin_notes=COALESCE($3,admin_notes), processed_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [status, mpesa_code||null, admin_notes||null, req.params.id]);
    res.json({ message: 'Withdrawal updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update withdrawal' }); }
});

// CAPITAL OVERVIEW
router.get('/capital', async (req, res) => {
  try {
    const [rev, comm, wd] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount),0) as total FROM enrollments WHERE payment_status='verified'`),
      query(`SELECT COALESCE(SUM(amount),0) as total FROM referral_earnings WHERE status='paid'`),
      query(`SELECT COALESCE(SUM(amount),0) as total FROM withdrawal_requests WHERE status='paid'`)
    ]);
    res.json({ capital: {
      total_revenue: parseInt(rev.rows[0].total),
      commissions_paid: parseInt(comm.rows[0].total),
      withdrawals_paid: parseInt(wd.rows[0].total)
    }});
  } catch(err) { res.status(500).json({ error: 'Failed to get capital' }); }
});

module.exports = router;
