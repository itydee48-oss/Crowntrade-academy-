const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { grantMentorship, grantPartnerStatus } = require('../database/identity');

router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  try {
    const [mTotal,mPending,mApproved,mRejected,rTotal,rPending,rApproved,rRejected,uTotal,uActive,ePending,ePaid] = await Promise.all([
      query('SELECT COUNT(*)::int as c FROM mentorship_applications'),
      query(`SELECT COUNT(*)::int as c FROM mentorship_applications WHERE status='pending'`),
      query(`SELECT COUNT(*)::int as c FROM mentorship_applications WHERE status='approved'`),
      query(`SELECT COUNT(*)::int as c FROM mentorship_applications WHERE status='rejected'`),
      query('SELECT COUNT(*)::int as c FROM referral_applications'),
      query(`SELECT COUNT(*)::int as c FROM referral_applications WHERE status='pending'`),
      query(`SELECT COUNT(*)::int as c FROM referral_applications WHERE status='approved'`),
      query(`SELECT COUNT(*)::int as c FROM referral_applications WHERE status='rejected'`),
      query('SELECT COUNT(*)::int as c FROM users'),
      query(`SELECT COUNT(*)::int as c FROM users WHERE status='active'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as s FROM referral_earnings WHERE status='pending'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as s FROM referral_earnings WHERE status='paid'`)
    ]);
    res.json({ stats: {
      mentorship: { total:mTotal.rows[0].c, pending:mPending.rows[0].c, approved:mApproved.rows[0].c, rejected:mRejected.rows[0].c },
      referral:   { total:rTotal.rows[0].c, pending:rPending.rows[0].c, approved:rApproved.rows[0].c, rejected:rRejected.rows[0].c },
      users:      { total:uTotal.rows[0].c, active:uActive.rows[0].c },
      earnings:   { total_pending:ePending.rows[0].s, total_paid:ePaid.rows[0].s }
    }});
  } catch (err) { console.error('Stats error:', err); res.status(500).json({ error: 'Failed to load stats' }); }
});

// ── MENTORSHIP APPLICATIONS ──────────────────────────────────────────────────
router.get('/mentorship', async (req, res) => {
  try {
    const { status, page=1, limit=20 } = req.query;
    const offset = (page-1)*limit;
    let sql = `SELECT ma.*,u.full_name,u.email,u.phone,u.member_number FROM mentorship_applications ma JOIN users u ON u.id=ma.user_id`;
    const params = [];
    if (status) { params.push(status); sql += ` WHERE ma.status=$${params.length}`; }
    params.push(Number(limit),Number(offset));
    sql += ` ORDER BY ma.submitted_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const apps = await query(sql, params);
    const countSql = `SELECT COUNT(*)::int as c FROM mentorship_applications${status?' WHERE status=$1':''}`;
    const total = await query(countSql, status?[status]:[]);
    res.json({ applications:apps.rows, total:total.rows[0].c, page:Number(page), limit:Number(limit) });
  } catch (err) { res.status(500).json({ error: 'Failed to get applications' }); }
});

router.get('/mentorship/:id', async (req, res) => {
  try {
    const result = await query(`SELECT ma.*,u.full_name,u.email,u.phone,u.member_number FROM mentorship_applications ma JOIN users u ON u.id=ma.user_id WHERE ma.id=$1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Application not found' });
    res.json({ application: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to get application' }); }
});

router.patch('/mentorship/:id', async (req, res) => {
  try {
    const { status, payment_status, admin_notes } = req.body;
    const result = await query('SELECT * FROM mentorship_applications WHERE id=$1', [req.params.id]);
    const app = result.rows[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });

    await query(`UPDATE mentorship_applications SET status=COALESCE($1,status),payment_status=COALESCE($2,payment_status),admin_notes=COALESCE($3,admin_notes),reviewed_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [status||null, payment_status||null, admin_notes||null, req.params.id]);

    // KEY WIRING: approval flips has_mentorship + has_partner_status on users row
    if (status==='approved' && app.status!=='approved') {
      await grantMentorship(app.user_id);
    }
    res.json({ message: 'Application updated successfully' });
  } catch (err) { console.error('Update mentorship error:', err); res.status(500).json({ error: 'Failed to update application' }); }
});

// ── REFERRAL APPLICATIONS ────────────────────────────────────────────────────
router.get('/referral', async (req, res) => {
  try {
    const { status, page=1, limit=20 } = req.query;
    const offset = (page-1)*limit;
    let sql = `SELECT ra.*,u.full_name,u.email,u.phone,u.member_number,u.referral_code,u.partner_tier FROM referral_applications ra JOIN users u ON u.id=ra.user_id`;
    const params = [];
    if (status) { params.push(status); sql += ` WHERE ra.status=$${params.length}`; }
    params.push(Number(limit),Number(offset));
    sql += ` ORDER BY ra.submitted_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const apps = await query(sql, params);
    const countSql = `SELECT COUNT(*)::int as c FROM referral_applications${status?' WHERE status=$1':''}`;
    const total = await query(countSql, status?[status]:[]);
    res.json({ applications:apps.rows, total:total.rows[0].c, page:Number(page), limit:Number(limit) });
  } catch (err) { res.status(500).json({ error: 'Failed to get referral applications' }); }
});

router.get('/referral/:id', async (req, res) => {
  try {
    const result = await query(`SELECT ra.*,u.full_name,u.email,u.phone,u.member_number,u.referral_code,u.partner_tier FROM referral_applications ra JOIN users u ON u.id=ra.user_id WHERE ra.id=$1`, [req.params.id]);
    const app = result.rows[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const earnings = await query('SELECT * FROM referral_earnings WHERE referrer_user_id=$1', [app.user_id]);
    res.json({ application:app, earnings:earnings.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get application' }); }
});

router.patch('/referral/:id', async (req, res) => {
  try {
    const { status, payment_status, admin_notes } = req.body;
    const result = await query('SELECT * FROM referral_applications WHERE id=$1', [req.params.id]);
    const app = result.rows[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });

    await query(`UPDATE referral_applications SET status=COALESCE($1,status),payment_status=COALESCE($2,payment_status),admin_notes=COALESCE($3,admin_notes),reviewed_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [status||null, payment_status||null, admin_notes||null, req.params.id]);

    // KEY WIRING: approval fills a spot AND grants has_partner_status on users row
    if (status==='approved' && app.status!=='approved') {
      await query('UPDATE referral_settings SET spots_filled=spots_filled+1 WHERE id=1');
      const userResult = await query('SELECT referral_code FROM users WHERE id=$1', [app.user_id]);
      await grantPartnerStatus(app.user_id, { tier:'bronze', referralCode:userResult.rows[0]?.referral_code });
    }
    if (status && status!=='approved' && app.status==='approved') {
      await query('UPDATE referral_settings SET spots_filled=GREATEST(0,spots_filled-1) WHERE id=1');
    }
    res.json({ message: 'Referral application updated successfully' });
  } catch (err) { console.error('Update referral error:', err); res.status(500).json({ error: 'Failed to update referral application' }); }
});

// ── USERS ────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const result = await query('SELECT id,full_name,email,phone,status,has_mentorship,has_partner_status,partner_tier,member_number,created_at FROM users ORDER BY created_at DESC');
    res.json({ users: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get users' }); }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const { status } = req.body;
    await query('UPDATE users SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2', [status, req.params.id]);
    res.json({ message: 'User updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update user' }); }
});

// ── MENTORS ──────────────────────────────────────────────────────────────────
router.post('/mentor/create', async (req, res) => {
  try {
    const { full_name, email, phone, password } = req.body;
    if (!full_name||!email||!password) return res.status(400).json({ error: 'Name, email and password required' });
    const exists = await query('SELECT id FROM mentors WHERE email=$1', [email]);
    if (exists.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const result = await query('INSERT INTO mentors (full_name,email,phone,password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
      [full_name, email, phone||null, hash]);
    res.status(201).json({ message:'Mentor account created', id:result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to create mentor' }); }
});

// ── ENROLLMENTS ──────────────────────────────────────────────────────────────
router.get('/enrollments', async (req, res) => {
  try {
    const { status, course_id, page=1, limit=20 } = req.query;
    const offset = (page-1)*limit;
    let sql = `SELECT e.*,c.title as course_title,c.price as course_price,u.full_name,u.email,u.phone,u.member_number,u.referred_by_code FROM enrollments e JOIN courses c ON e.course_id=c.id JOIN users u ON u.id=e.user_id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND e.status=$${params.length}`; }
    if (course_id) { params.push(course_id); sql += ` AND e.course_id=$${params.length}`; }
    params.push(Number(limit),Number(offset));
    sql += ` ORDER BY e.submitted_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const enrollments = await query(sql, params);
    let countSql = 'SELECT COUNT(*)::int as c FROM enrollments e WHERE 1=1';
    const countParams = [];
    if (status) { countParams.push(status); countSql += ` AND e.status=$${countParams.length}`; }
    if (course_id) { countParams.push(course_id); countSql += ` AND e.course_id=$${countParams.length}`; }
    const total = await query(countSql, countParams);
    res.json({ enrollments:enrollments.rows, total:total.rows[0].c, page:Number(page), limit:Number(limit) });
  } catch (err) { console.error('Get enrollments error:', err); res.status(500).json({ error: 'Failed to get enrollments' }); }
});

router.get('/enrollments/:id', async (req, res) => {
  try {
    const result = await query(`SELECT e.*,c.title as course_title,u.full_name,u.email,u.phone,u.member_number FROM enrollments e JOIN courses c ON e.course_id=c.id JOIN users u ON u.id=e.user_id WHERE e.id=$1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Enrollment not found' });
    res.json({ enrollment: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to get enrollment' }); }
});

router.patch('/enrollments/:id', async (req, res) => {
  try {
    const { status, payment_status, admin_notes } = req.body;
    const result = await query('SELECT * FROM enrollments WHERE id=$1', [req.params.id]);
    const enrollment = result.rows[0];
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    await query(`UPDATE enrollments SET status=COALESCE($1,status),payment_status=COALESCE($2,payment_status),admin_notes=COALESCE($3,admin_notes),reviewed_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [status||null, payment_status||null, admin_notes||null, req.params.id]);

    res.json({ message: 'Enrollment updated successfully' });
  } catch (err) { res.status(500).json({ error: 'Failed to update enrollment' }); }
});

// ── CAPITAL OVERVIEW ─────────────────────────────────────────────────────────
router.get('/capital', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const [totalPending, totalAvailable, totalPaid, pendingW, partners, clientRoster] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount),0)::int as s FROM referral_earnings WHERE status='pending' AND (available_after IS NULL OR available_after>$1)`, [now]),
      query(`SELECT COALESCE(SUM(amount),0)::int as s FROM referral_earnings WHERE status='available' OR (status='pending' AND available_after IS NOT NULL AND available_after<=$1)`, [now]),
      query(`SELECT COALESCE(SUM(amount),0)::int as s FROM withdrawal_requests WHERE status='paid'`),
      query(`SELECT wr.*,u.full_name,u.email,u.phone,u.partner_tier,u.member_number FROM withdrawal_requests wr JOIN users u ON wr.referrer_user_id=u.id WHERE wr.status='pending' ORDER BY wr.requested_at ASC`),
      query(`SELECT u.id,u.member_number,u.full_name,u.email,u.phone,u.partner_tier as tier,u.referral_code,ra.status,ra.welcomed,
        COUNT(DISTINCT re.id)::int as total_referrals,
        COALESCE(SUM(CASE WHEN re.status='available' OR (re.status='pending' AND re.available_after IS NOT NULL AND re.available_after<=$1) THEN re.amount ELSE 0 END),0)::int as available_balance,
        COALESCE(SUM(CASE WHEN re.status='pending' AND (re.available_after IS NULL OR re.available_after>$1) THEN re.amount ELSE 0 END),0)::int as pending_balance,
        COALESCE(SUM(CASE WHEN re.status IN ('available','pending') THEN re.amount ELSE 0 END),0)::int as lifetime_earned,
        COALESCE((SELECT SUM(wr2.amount) FROM withdrawal_requests wr2 WHERE wr2.referrer_user_id=u.id AND wr2.status='paid'),0)::int as total_withdrawn
        FROM users u JOIN referral_applications ra ON ra.user_id=u.id LEFT JOIN referral_earnings re ON re.referrer_user_id=u.id
        WHERE u.has_partner_status=TRUE GROUP BY u.id,ra.status,ra.welcomed ORDER BY lifetime_earned DESC`, [now]),
      query(`SELECT e.id,u.member_number,u.full_name,u.email,u.phone,e.status,e.payment_status,e.amount,e.submitted_at,c.title as course_title,c.slug as course_slug,u.referred_by_code FROM enrollments e JOIN courses c ON e.course_id=c.id JOIN users u ON u.id=e.user_id ORDER BY e.submitted_at DESC`)
    ]);
    const avail = totalAvailable.rows[0].s;
    const paid = totalPaid.rows[0].s;
    res.json({
      capital: { total_pending:totalPending.rows[0].s, total_available:avail, total_paid_out:paid, total_liability:Math.max(0,avail-paid) },
      pending_withdrawals: pendingW.rows,
      partners: partners.rows,
      client_roster: clientRoster.rows
    });
  } catch (err) { console.error('Capital overview error:', err); res.status(500).json({ error: 'Failed to load capital overview' }); }
});

// ── COMMISSION CONTROLS ───────────────────────────────────────────────────────
router.post('/release-commission/:enrollmentId', async (req, res) => {
  try {
    const result = await query('SELECT * FROM enrollments WHERE id=$1', [req.params.enrollmentId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Enrollment not found' });
    const availableAfter = new Date(Date.now()+48*60*60*1000).toISOString();
    await query(`UPDATE referral_earnings SET available_after=$1,status='pending' WHERE source_type='enrollment' AND source_id=$2 AND status='pending'`,
      [availableAfter, req.params.enrollmentId]);
    res.json({ message:'Commission release timer started. Available in 48 hours.', available_after:availableAfter });
  } catch (err) { res.status(500).json({ error: 'Failed to release commission' }); }
});

router.patch('/earnings/:id/release', async (req, res) => {
  try {
    await query(`UPDATE referral_earnings SET status='available',available_after=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ message:'Commission marked available' });
  } catch (err) { res.status(500).json({ error: 'Failed to release commission' }); }
});

router.patch('/earnings/:id/pay', async (req, res) => {
  try {
    await query(`UPDATE referral_earnings SET status='paid' WHERE id=$1`, [req.params.id]);
    res.json({ message:'Earnings marked as paid' });
  } catch (err) { res.status(500).json({ error: 'Failed to update earnings' }); }
});

// ── WITHDRAWALS ───────────────────────────────────────────────────────────────
router.get('/withdrawals', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT wr.*,u.full_name,u.email,u.phone,u.partner_tier as tier,u.member_number FROM withdrawal_requests wr JOIN users u ON wr.referrer_user_id=u.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND wr.status=$${params.length}`; }
    sql += ' ORDER BY wr.requested_at DESC';
    const result = await query(sql, params);
    res.json({ withdrawals: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to load withdrawals' }); }
});

router.patch('/withdrawals/:id', async (req, res) => {
  try {
    const { status, mpesa_code, admin_notes } = req.body;
    const result = await query('SELECT * FROM withdrawal_requests WHERE id=$1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Withdrawal not found' });
    await query(`UPDATE withdrawal_requests SET status=COALESCE($1,status),mpesa_code=COALESCE($2,mpesa_code),admin_notes=COALESCE($3,admin_notes),processed_at=CASE WHEN $1 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE processed_at END WHERE id=$4`,
      [status||null, mpesa_code||null, admin_notes||null, req.params.id]);
    res.json({ message:'Withdrawal updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update withdrawal' }); }
});

// ── SPOTS ─────────────────────────────────────────────────────────────────────
router.patch('/spots', async (req, res) => {
  try {
    const { total_spots } = req.body;
    await query('UPDATE referral_settings SET total_spots=$1 WHERE id=1', [total_spots]);
    res.json({ message:'Spots updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update spots' }); }
});


// ── LIST ALL MENTORS ──────────────────────────────────────────────────────────
router.get('/mentor-list', async (req, res) => {
  try {
    const result = await query(`
      SELECT m.*,
        COUNT(DISTINCT u.id)::int as client_count
      FROM mentors m
      LEFT JOIN users u ON u.mentor_id = m.id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `);
    res.json({ mentors: result.rows });
  } catch(err) {
    console.error('Mentor list error:', err);
    res.status(500).json({ error: 'Failed to get mentors' });
  }
});

// ── TOGGLE MENTOR STATUS ──────────────────────────────────────────────────────
router.patch('/mentor/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active','suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await query('UPDATE mentors SET status=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ message: 'Mentor status updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update mentor' }); }
});

module.exports = router;
