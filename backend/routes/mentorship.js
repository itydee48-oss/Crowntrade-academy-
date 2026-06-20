const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getDB } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');

// ─── SUBMIT MENTORSHIP APPLICATION (creates account immediately) ────────────
router.post('/apply', async (req, res) => {
  try {
    const {
      full_name, email, phone, password, experience_level,
      trading_goals, preferred_markets, time_commitment
    } = req.body;

    if (!full_name || !email || !phone || !password || !experience_level || !trading_goals || !time_commitment) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDB();

    const existing = db.prepare(
      "SELECT id FROM mentorship_applications WHERE email = ? AND status != 'rejected'"
    ).get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in instead.' });
    }

    const marketsStr = Array.isArray(preferred_markets)
      ? preferred_markets.join(', ')
      : preferred_markets || '';

    const password_hash = await bcrypt.hash(password, 10);

    // Assign next member number
    const countRow = db.prepare('SELECT COUNT(*) as c FROM mentorship_applications').get();
    const member_number = (countRow?.c || 0) + 1;

    const result = db.prepare(`
      INSERT INTO mentorship_applications
        (member_number, full_name, email, phone, password_hash, experience_level, trading_goals, preferred_markets, time_commitment, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3500)
    `).run(member_number, full_name, email, phone, password_hash, experience_level, trading_goals, marketsStr, time_commitment);

    // Issue a token immediately so they're auto-logged-in
    const token = generateToken({ id: result.lastInsertRowid, email, role: 'client' }, '30d');

    res.status(201).json({
      message: 'Application submitted successfully.',
      application_id: result.lastInsertRowid,
      member_number,
      token,
      user: {
        id: result.lastInsertRowid,
        full_name,
        email,
        role: 'client',
        status: 'pending',
        member_number
      }
    });
  } catch (err) {
    console.error('Mentorship apply error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// ─── CLIENT LOGIN (email + password) ──────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = getDB();
    const app = db.prepare(
      'SELECT * FROM mentorship_applications WHERE email = ? ORDER BY submitted_at DESC LIMIT 1'
    ).get(email);

    if (!app || !app.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, app.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({ id: app.id, email: app.email, role: 'client' }, '30d');

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: app.id,
        full_name: app.full_name,
        email: app.email,
        role: 'client',
        status: app.status,
        member_number: app.member_number
      }
    });
  } catch (err) {
    console.error('Mentorship login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── ATTACH PAYMENT PROOF TO APPLICATION ─────────────────────────────────────
router.post('/payment-proof', async (req, res) => {
  try {
    const { email, proof_url } = req.body;
    if (!email || !proof_url) {
      return res.status(400).json({ error: 'Email and proof URL are required' });
    }

    const db = getDB();
    const app = db.prepare(
      "SELECT id FROM mentorship_applications WHERE email = ? AND status != 'rejected' ORDER BY submitted_at DESC LIMIT 1"
    ).get(email);

    if (!app) {
      return res.status(404).json({ error: 'No application found for this email' });
    }

    db.prepare(`
      UPDATE mentorship_applications
      SET payment_proof = ?, payment_status = 'pending'
      WHERE id = ?
    `).run(proof_url, app.id);

    res.json({ message: 'Payment proof submitted. We will verify shortly.' });
  } catch (err) {
    console.error('Payment proof error:', err);
    res.status(500).json({ error: 'Failed to submit payment proof' });
  }
});

// ─── GET OWN APPLICATION STATUS (by email, no auth) ──────────────────────────
router.get('/status/:email', (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare(
      'SELECT id, full_name, email, status, payment_status, payment_proof, member_number, submitted_at, admin_notes FROM mentorship_applications WHERE email = ? ORDER BY submitted_at DESC LIMIT 1'
    ).get(req.params.email);

    if (!app) return res.status(404).json({ error: 'No application found for this email' });
    res.json({ application: app });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get application status' });
  }
});

// ─── CLIENT DASHBOARD DATA (authenticated) ───────────────────────────────────
router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare(
      'SELECT * FROM mentorship_applications WHERE id = ?'
    ).get(req.user.id);

    if (!app) return res.status(404).json({ error: 'Application not found' });

    // Check if this is their first time seeing approved dashboard (welcome moment)
    const showWelcome = app.status === 'approved' && app.welcomed === 0;
    if (showWelcome) {
      db.prepare('UPDATE mentorship_applications SET welcomed = 1 WHERE id = ?').run(app.id);
    }

    res.json({
      application: { ...app, show_welcome: showWelcome },
      user: { email: req.user.email, role: req.user.role }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;
