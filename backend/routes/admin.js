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

module.exports = router;
