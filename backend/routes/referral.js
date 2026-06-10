const express = require('express');
const router = express.Router();
const { getDB } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// ─── REGISTER AS REFERRAL AGENT ───────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, referred_by_code, payment_proof } = req.body;

    if (!full_name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email and phone are required' });
    }
    if (!payment_proof) {
      return res.status(400).json({ error: 'Payment proof is required' });
    }

    const db = getDB();
    const existing = db.prepare('SELECT id FROM referral_applications WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An application with this email already exists' });
    }

    const referral_code = generateReferralCode(full_name);
    const referral_link = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login.html?ref=${referral_code}`;

    const result = db.prepare(`
      INSERT INTO referral_applications
        (full_name, email, phone, referred_by_code, payment_proof, referral_code, referral_link, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, 500)
    `).run(full_name, email, phone, referred_by_code || null, payment_proof, referral_code, referral_link);

    // Credit the referrer if a valid referral code was used
    if (referred_by_code) {
      const referrer = db.prepare(
        'SELECT id FROM referral_applications WHERE referral_code = ? AND status = ?'
      ).get(referred_by_code, 'approved');

      if (referrer) {
        db.prepare(`
          INSERT INTO referral_earnings (referrer_id, referred_email, amount, status)
          VALUES (?, ?, 200, 'pending')
        `).run(referrer.id, email);
      }
    }

    res.status(201).json({
      message: 'Application submitted! Your account will be reviewed within 24-48 hours.',
      application_id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Referral register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── GET REFERRAL DASHBOARD DATA ─────────────────────────────────────────────
router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    const db = getDB();
    const agent = db.prepare('SELECT * FROM referral_applications WHERE id = ?').get(req.user.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const earnings = db.prepare(
      'SELECT * FROM referral_earnings WHERE referrer_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);

    const totalEarnings = earnings.filter(e => e.status === 'paid').reduce((sum, e) => sum + e.amount, 0);
    const pendingEarnings = earnings.filter(e => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0);

    res.json({
      agent: {
        id: agent.id,
        full_name: agent.full_name,
        email: agent.email,
        phone: agent.phone,
        referral_code: agent.referral_code,
        referral_link: agent.referral_link,
        status: agent.status,
        total_referrals: earnings.length,
        total_earnings: totalEarnings,
        pending_earnings: pendingEarnings
      },
      earnings
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─── CHECK REFERRAL CODE VALIDITY ────────────────────────────────────────────
router.get('/check/:code', (req, res) => {
  try {
    const db = getDB();
    const agent = db.prepare(
      'SELECT full_name, referral_code FROM referral_applications WHERE referral_code = ? AND status = ?'
    ).get(req.params.code, 'approved');

    if (!agent) return res.status(404).json({ valid: false, message: 'Invalid referral code' });
    res.json({ valid: true, referrer_name: agent.full_name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check referral code' });
  }
});

// ─── GET APPLICATION STATUS ───────────────────────────────────────────────────
router.get('/status/:email', (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare(
      'SELECT id, full_name, email, status, payment_status, referral_code, submitted_at FROM referral_applications WHERE email = ?'
    ).get(req.params.email);

    if (!app) return res.status(404).json({ error: 'No application found' });
    res.json({ application: app });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// ─── HELPER ───────────────────────────────────────────────────────────────────
function generateReferralCode(name) {
  const base = name.replace(/\s+/g, '').toUpperCase().slice(0, 4);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${base}${rand}`;
}

module.exports = router;
