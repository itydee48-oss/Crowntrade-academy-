const express = require('express');
const router = express.Router();
const { getDB } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// ─── SUBMIT MENTORSHIP APPLICATION ───────────────────────────────────────────
router.post('/apply', async (req, res) => {
  try {
    const {
      full_name, email, phone, experience_level,
      trading_goals, preferred_markets, time_commitment
    } = req.body;

    if (!full_name || !email || !phone || !experience_level || !trading_goals || !time_commitment) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }

    const db = getDB();

    // Check for duplicate applications
    const existing = db.prepare(
      "SELECT id FROM mentorship_applications WHERE email = ? AND status != 'rejected'"
    ).get(email);
    if (existing) {
      return res.status(409).json({ error: 'An application with this email already exists' });
    }

    const marketsStr = Array.isArray(preferred_markets)
      ? preferred_markets.join(', ')
      : preferred_markets || '';

    const result = db.prepare(`
      INSERT INTO mentorship_applications
        (full_name, email, phone, experience_level, trading_goals, preferred_markets, time_commitment, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, 3500)
    `).run(full_name, email, phone, experience_level, trading_goals, marketsStr, time_commitment);

    res.status(201).json({
      message: 'Application submitted successfully! We will review and contact you shortly.',
      application_id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Mentorship apply error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// ─── GET OWN APPLICATION STATUS ──────────────────────────────────────────────
router.get('/status/:email', (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare(
      'SELECT id, full_name, email, status, payment_status, submitted_at FROM mentorship_applications WHERE email = ?'
    ).get(req.params.email);

    if (!app) return res.status(404).json({ error: 'No application found for this email' });
    res.json({ application: app });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get application status' });
  }
});

// ─── CLIENT DASHBOARD DATA ───────────────────────────────────────────────────
router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare(
      'SELECT * FROM mentorship_applications WHERE email = ? ORDER BY submitted_at DESC LIMIT 1'
    ).get(req.user.email);

    res.json({
      application: app || null,
      user: { email: req.user.email, role: req.user.role }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;
