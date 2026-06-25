const express = require('express');
const router = express.Router();
const { getDB } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

// All admin routes require admin role
router.use(requireAdmin);

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    const db = getDB();
    const stats = {
      mentorship: {
        total: db.prepare('SELECT COUNT(*) as c FROM mentorship_applications').get().c,
        pending: db.prepare("SELECT COUNT(*) as c FROM mentorship_applications WHERE status='pending'").get().c,
        approved: db.prepare("SELECT COUNT(*) as c FROM mentorship_applications WHERE status='approved'").get().c,
        rejected: db.prepare("SELECT COUNT(*) as c FROM mentorship_applications WHERE status='rejected'").get().c,
      },
      referral: {
        total: db.prepare('SELECT COUNT(*) as c FROM referral_applications').get().c,
        pending: db.prepare("SELECT COUNT(*) as c FROM referral_applications WHERE status='pending'").get().c,
        approved: db.prepare("SELECT COUNT(*) as c FROM referral_applications WHERE status='approved'").get().c,
        rejected: db.prepare("SELECT COUNT(*) as c FROM referral_applications WHERE status='rejected'").get().c,
      },
      users: {
        total: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
        active: db.prepare("SELECT COUNT(*) as c FROM users WHERE status='active'").get().c,
      },
      earnings: {
        total_pending: db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM referral_earnings WHERE status='pending'").get().s,
        total_paid: db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM referral_earnings WHERE status='paid'").get().s,
      }
    };
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ─── MENTORSHIP APPLICATIONS ──────────────────────────────────────────────────
router.get('/mentorship', (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const db = getDB();
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM mentorship_applications';
    const params = [];
    if (status) { query += ' WHERE status = ?'; params.push(status); }
    query += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const applications = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as c FROM mentorship_applications${status ? ' WHERE status=?' : ''}`).get(...(status ? [status] : [])).c;

    res.json({ applications, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

router.get('/mentorship/:id', (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare('SELECT * FROM mentorship_applications WHERE id = ?').get(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    res.json({ application: app });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get application' });
  }
});

router.patch('/mentorship/:id', (req, res) => {
  try {
    const { status, payment_status, admin_notes } = req.body;
    const db = getDB();
    const app = db.prepare('SELECT * FROM mentorship_applications WHERE id = ?').get(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    db.prepare(`
      UPDATE mentorship_applications
      SET status = COALESCE(?, status),
          payment_status = COALESCE(?, payment_status),
          admin_notes = COALESCE(?, admin_notes),
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status || null, payment_status || null, admin_notes || null, req.params.id);

    res.json({ message: 'Application updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// ─── REFERRAL APPLICATIONS ────────────────────────────────────────────────────
router.get('/referral', (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const db = getDB();
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM referral_applications';
    const params = [];
    if (status) { query += ' WHERE status = ?'; params.push(status); }
    query += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const applications = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as c FROM referral_applications${status ? ' WHERE status=?' : ''}`).get(...(status ? [status] : [])).c;

    res.json({ applications, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get referral applications' });
  }
});

router.get('/referral/:id', (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare('SELECT * FROM referral_applications WHERE id = ?').get(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const earnings = db.prepare('SELECT * FROM referral_earnings WHERE referrer_id = ?').all(req.params.id);
    res.json({ application: app, earnings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get application' });
  }
});

router.patch('/referral/:id', (req, res) => {
  try {
    const { status, payment_status, admin_notes } = req.body;
    const db = getDB();
    const app = db.prepare('SELECT * FROM referral_applications WHERE id = ?').get(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    db.prepare(`
      UPDATE referral_applications
      SET status = COALESCE(?, status),
          payment_status = COALESCE(?, payment_status),
          admin_notes = COALESCE(?, admin_notes),
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status || null, payment_status || null, admin_notes || null, req.params.id);

    // If newly approved (wasn't approved before, now is) — fill a spot
    if (status === 'approved' && app.status !== 'approved') {
      db.prepare('UPDATE referral_settings SET spots_filled = spots_filled + 1 WHERE id = 1').run();
    }
    // If un-approving someone who was approved — free up a spot
    if (status && status !== 'approved' && app.status === 'approved') {
      db.prepare('UPDATE referral_settings SET spots_filled = MAX(0, spots_filled - 1) WHERE id = 1').run();
    }

    res.json({ message: 'Referral application updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update referral application' });
  }
});

// Mark referral earnings as paid
router.patch('/earnings/:id/pay', (req, res) => {
  try {
    const db = getDB();
    db.prepare("UPDATE referral_earnings SET status = 'paid' WHERE id = ?").run(req.params.id);

    // Update total earnings on the referral agent record
    const earning = db.prepare('SELECT * FROM referral_earnings WHERE id = ?').get(req.params.id);
    if (earning) {
      db.prepare('UPDATE referral_applications SET earnings = earnings + ? WHERE id = ?')
        .run(earning.amount, earning.referrer_id);
    }

    res.json({ message: 'Earnings marked as paid' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update earnings' });
  }
});

// ─── USERS ────────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  try {
    const db = getDB();
    const users = db.prepare(
      'SELECT id, full_name, email, phone, role, status, created_at FROM users ORDER BY created_at DESC'
    ).all();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

router.patch('/users/:id', (req, res) => {
  try {
    const { status } = req.body;
    const db = getDB();
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ─── CREATE MENTOR ACCOUNT ────────────────────────────────────────────────────
router.post('/mentor/create', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { full_name, email, phone, password } = req.body;
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password required' });
    }
    const db = getDB();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 10);
    const result = db.prepare(`
      INSERT INTO users (full_name, email, phone, password_hash, role, status)
      VALUES (?, ?, ?, ?, 'mentor', 'active')
    `).run(full_name, email, phone || null, password_hash);

    res.status(201).json({ message: 'Mentor account created', id: result.lastInsertRowid });
  } catch (err) {
    console.error('Create mentor error:', err);
    res.status(500).json({ error: 'Failed to create mentor' });
  }
});

// ─── ENROLLMENTS (multi-course) ───────────────────────────────────────────────
router.get('/enrollments', (req, res) => {
  try {
    const { status, course_id, page = 1, limit = 20 } = req.query;
    const db = getDB();
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.*, c.title as course_title, c.price as course_price
      FROM enrollments e JOIN courses c ON e.course_id = c.id
      WHERE 1=1`;
    const params = [];
    if (status) { query += ' AND e.status = ?'; params.push(status); }
    if (course_id) { query += ' AND e.course_id = ?'; params.push(course_id); }
    query += ' ORDER BY e.submitted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const enrollments = db.prepare(query).all(...params);

    let countQuery = 'SELECT COUNT(*) as c FROM enrollments e WHERE 1=1';
    const countParams = [];
    if (status) { countQuery += ' AND e.status = ?'; countParams.push(status); }
    if (course_id) { countQuery += ' AND e.course_id = ?'; countParams.push(course_id); }
    const total = db.prepare(countQuery).get(...countParams).c;

    res.json({ enrollments, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('Get enrollments error:', err);
    res.status(500).json({ error: 'Failed to get enrollments' });
  }
});

router.get('/enrollments/:id', (req, res) => {
  try {
    const db = getDB();
    const enrollment = db.prepare(`
      SELECT e.*, c.title as course_title FROM enrollments e
      JOIN courses c ON e.course_id = c.id WHERE e.id = ?
    `).get(req.params.id);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    res.json({ enrollment });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get enrollment' });
  }
});

router.patch('/enrollments/:id', (req, res) => {
  try {
    const { status, payment_status, admin_notes } = req.body;
    const db = getDB();
    const enrollment = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(req.params.id);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    db.prepare(`
      UPDATE enrollments
      SET status = COALESCE(?, status),
          payment_status = COALESCE(?, payment_status),
          admin_notes = COALESCE(?, admin_notes),
          reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status || null, payment_status || null, admin_notes || null, req.params.id);

    // If approved and there's a pending referral earning tied to this enrollment, activate it
    if (status === 'approved' && enrollment.status !== 'approved') {
      db.prepare(`
        UPDATE referral_earnings SET status = 'pending'
        WHERE source_type = 'course' AND source_id = ? AND status = 'pending'
      `).run(req.params.id);
    }

    res.json({ message: 'Enrollment updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update enrollment' });
  }
});

// ─── CAPITAL OVERVIEW ─────────────────────────────────────────────────────────
router.get('/capital', (req, res) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();

    // Total pending (not yet 48hrs old)
    const totalPending = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as s FROM referral_earnings
      WHERE status = 'pending' AND (available_after IS NULL OR available_after > ?)
    `).get(now).s;

    // Total available (48hrs passed, not yet paid)
    const totalAvailable = db.prepare(`
      SELECT COALESCE(SUM(re.amount),0) as s
      FROM referral_earnings re
      WHERE re.status IN ('available') OR (re.status = 'pending' AND re.available_after IS NOT NULL AND re.available_after <= ?)
    `).get(now).s;

    // Total paid out ever
    const totalPaid = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as s FROM withdrawal_requests WHERE status = 'paid'
    `).get().s;

    // Pending withdrawals
    const pendingWithdrawals = db.prepare(`
      SELECT wr.*, ra.full_name, ra.email, ra.phone, ra.tier, ra.member_number
      FROM withdrawal_requests wr
      JOIN referral_applications ra ON wr.referrer_id = ra.id
      WHERE wr.status = 'pending'
      ORDER BY wr.requested_at ASC
    `).all();

    // Per-partner breakdown
    const partners = db.prepare(`
      SELECT ra.id, ra.member_number, ra.full_name, ra.email, ra.phone, ra.tier,
        ra.referral_code, ra.status, ra.welcomed,
        COUNT(DISTINCT re.id) as total_referrals,
        COALESCE(SUM(CASE WHEN re.status IN ('available') OR (re.status='pending' AND re.available_after IS NOT NULL AND re.available_after <= ?) THEN re.amount ELSE 0 END),0) as available_balance,
        COALESCE(SUM(CASE WHEN re.status='pending' AND (re.available_after IS NULL OR re.available_after > ?) THEN re.amount ELSE 0 END),0) as pending_balance,
        COALESCE(SUM(CASE WHEN re.status IN ('available','pending') THEN re.amount ELSE 0 END),0) as lifetime_earned,
        COALESCE((SELECT SUM(wr.amount) FROM withdrawal_requests wr WHERE wr.referrer_id = ra.id AND wr.status = 'paid'),0) as total_withdrawn
      FROM referral_applications ra
      LEFT JOIN referral_earnings re ON re.referrer_id = ra.id
      WHERE ra.status = 'approved'
      GROUP BY ra.id
      ORDER BY lifetime_earned DESC
    `).all(now, now);

    // Client roster (all enrollments)
    const clientRoster = db.prepare(`
      SELECT e.id, e.member_number, e.full_name, e.email, e.phone,
        e.status, e.payment_status, e.amount, e.submitted_at,
        c.title as course_title, c.slug as course_slug,
        e.referred_by_code
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      ORDER BY e.submitted_at DESC
    `).all();

    res.json({
      capital: {
        total_pending: totalPending,
        total_available: totalAvailable,
        total_paid_out: totalPaid,
        total_liability: totalAvailable - totalPaid < 0 ? 0 : totalAvailable - totalPaid
      },
      pending_withdrawals: pendingWithdrawals,
      partners,
      client_roster: clientRoster
    });
  } catch (err) {
    console.error('Capital overview error:', err);
    res.status(500).json({ error: 'Failed to load capital overview' });
  }
});

// ─── APPROVE ENROLLMENT → RELEASE COMMISSION ──────────────────────────────────
// When admin approves an enrollment, set commission available_after = now + 48hrs
router.post('/release-commission/:enrollmentId', (req, res) => {
  try {
    const db = getDB();
    const enrollment = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(req.params.enrollmentId);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    const availableAfter = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE referral_earnings
      SET available_after = ?, status = 'pending'
      WHERE source_type = 'enrollment' AND source_id = ? AND status = 'pending'
    `).run(availableAfter, enrollment.id);

    res.json({ message: 'Commission release timer started. Available in 48 hours.', available_after: availableAfter });
  } catch (err) {
    res.status(500).json({ error: 'Failed to release commission' });
  }
});

// ─── WITHDRAWAL MANAGEMENT ────────────────────────────────────────────────────
router.get('/withdrawals', (req, res) => {
  try {
    const db = getDB();
    const { status } = req.query;
    let query = `
      SELECT wr.*, ra.full_name, ra.email, ra.phone, ra.tier, ra.member_number
      FROM withdrawal_requests wr
      JOIN referral_applications ra ON wr.referrer_id = ra.id
      WHERE 1=1`;
    const params = [];
    if (status) { query += ' AND wr.status = ?'; params.push(status); }
    query += ' ORDER BY wr.requested_at DESC';
    const withdrawals = db.prepare(query).all(...params);
    res.json({ withdrawals });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

router.patch('/withdrawals/:id', (req, res) => {
  try {
    const { status, mpesa_code, admin_notes } = req.body;
    const db = getDB();
    const withdrawal = db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(req.params.id);
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

    db.prepare(`
      UPDATE withdrawal_requests
      SET status = COALESCE(?, status),
          mpesa_code = COALESCE(?, mpesa_code),
          admin_notes = COALESCE(?, admin_notes),
          processed_at = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE processed_at END
      WHERE id = ?
    `).run(status || null, mpesa_code || null, admin_notes || null, status || null, req.params.id);

    res.json({ message: 'Withdrawal updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update withdrawal' });
  }
});

// ─── ADMIN: MANUALLY MARK COMMISSION AVAILABLE ────────────────────────────────
router.patch('/earnings/:id/release', (req, res) => {
  try {
    const db = getDB();
    db.prepare("UPDATE referral_earnings SET status = 'available', available_after = CURRENT_TIMESTAMP WHERE id = ?")
      .run(req.params.id);
    res.json({ message: 'Commission marked available' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to release commission' });
  }
});

router.patch('/earnings/:id/pay', (req, res) => {
  try {
    const db = getDB();
    const earning = db.prepare('SELECT * FROM referral_earnings WHERE id = ?').get(req.params.id);
    if (earning) {
      db.prepare("UPDATE referral_earnings SET status = 'paid' WHERE id = ?").run(req.params.id);
      db.prepare('UPDATE referral_applications SET earnings = earnings + ? WHERE id = ?')
        .run(earning.amount, earning.referrer_id);
    }
    res.json({ message: 'Earnings marked as paid' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update earnings' });
  }
});

// ─── UPDATE SPOTS SETTINGS ────────────────────────────────────────────────────
router.patch('/spots', (req, res) => {
  try {
    const { total_spots } = req.body;
    const db = getDB();
    db.prepare('UPDATE referral_settings SET total_spots = ? WHERE id = 1').run(total_spots);
    res.json({ message: 'Spots updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update spots' });
  }
});

module.exports = router;
