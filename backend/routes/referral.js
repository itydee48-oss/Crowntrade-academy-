const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getDB } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');

// ─── TIER THRESHOLDS ──────────────────────────────────────────────────────────
const TIERS = [
  { name: 'crown',  min: 20, rate: 300, label: 'Crown Partner' },
  { name: 'gold',   min: 10, rate: 250, label: 'Gold Partner' },
  { name: 'silver', min: 5,  rate: 220, label: 'Silver Partner' },
  { name: 'bronze', min: 0,  rate: 200, label: 'Bronze Partner' }
];

function getTierForCount(count) {
  return TIERS.find(t => count >= t.min) || TIERS[TIERS.length - 1];
}

// ─── SPOTS REMAINING (public) ─────────────────────────────────────────────────
router.get('/spots', (req, res) => {
  try {
    const db = getDB();
    const settings = db.prepare('SELECT * FROM referral_settings WHERE id = 1').get();
    const remaining = Math.max(0, (settings?.total_spots || 50) - (settings?.spots_filled || 0));
    res.json({
      total_spots: settings?.total_spots || 50,
      spots_filled: settings?.spots_filled || 0,
      spots_remaining: remaining,
      is_full: remaining <= 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get spots info' });
  }
});

// ─── APPLY FOR REFERRAL PROGRAM (creates account immediately) ───────────────
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, motivation, referred_by_code, payment_proof } = req.body;

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Name, email, phone and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!payment_proof) {
      return res.status(400).json({ error: 'Payment proof is required' });
    }

    const db = getDB();
    const existing = db.prepare('SELECT id FROM referral_applications WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in instead.' });
    }

    // Check spots remaining
    const settings = db.prepare('SELECT * FROM referral_settings WHERE id = 1').get();
    const remaining = (settings?.total_spots || 50) - (settings?.spots_filled || 0);
    if (remaining <= 0) {
      return res.status(403).json({ error: 'All Crown Partner spots are currently filled. Join the waitlist by emailing us.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const referral_code = generateReferralCode(full_name);
    const referral_link = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/referral-register.html?ref=${referral_code}`;

    // Assign next member number
    const memberCountRow = db.prepare('SELECT COUNT(*) as c FROM referral_applications').get();
    const member_number = (memberCountRow?.c || 0) + 1;

    const result = db.prepare(`
      INSERT INTO referral_applications
        (member_number, full_name, email, phone, password_hash, motivation, referred_by_code, payment_proof, referral_code, referral_link, amount, tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 500, 'bronze')
    `).run(member_number, full_name, email, phone, password_hash, motivation || null, referred_by_code || null, payment_proof, referral_code, referral_link);

    // Credit the referrer if a valid referral code was used (referrer must already be approved)
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

    // Issue a token immediately so they can log in and check status anytime
    const token = generateToken({ id: result.lastInsertRowid, email, role: 'referral' }, '30d');

    res.status(201).json({
      message: 'Application submitted! You can log in anytime to check your status.',
      application_id: result.lastInsertRowid,
      member_number,
      token,
      user: {
        id: result.lastInsertRowid,
        full_name,
        email,
        role: 'referral',
        status: 'pending',
        member_number
      }
    });
  } catch (err) {
    console.error('Referral register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── REFERRAL LOGIN (email + password) ───────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = getDB();
    const agent = db.prepare('SELECT * FROM referral_applications WHERE email = ?').get(email);

    if (!agent || !agent.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (agent.status === 'rejected') {
      return res.status(403).json({ error: 'Your application was not approved. Contact support for details.' });
    }

    const token = generateToken({ id: agent.id, email: agent.email, role: 'referral' }, '30d');

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: agent.id,
        full_name: agent.full_name,
        email: agent.email,
        role: 'referral',
        status: agent.status,
        member_number: agent.member_number,
        tier: agent.tier,
        referral_code: agent.referral_code
      }
    });
  } catch (err) {
    console.error('Referral login error:', err);
    res.status(500).json({ error: 'Login failed' });
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
    const approvedReferralCount = earnings.length;

    // Calculate current tier based on approved referral count
    const currentTier = getTierForCount(approvedReferralCount);

    // Update tier in DB if changed
    if (agent.tier !== currentTier.name) {
      db.prepare('UPDATE referral_applications SET tier = ? WHERE id = ?').run(currentTier.name, agent.id);
    }

    // Check if this is their first time seeing approved dashboard (welcome moment)
    const showWelcome = agent.status === 'approved' && agent.welcomed === 0;
    if (showWelcome) {
      db.prepare('UPDATE referral_applications SET welcomed = 1 WHERE id = ?').run(agent.id);
    }

    res.json({
      agent: {
        id: agent.id,
        member_number: agent.member_number,
        full_name: agent.full_name,
        email: agent.email,
        phone: agent.phone,
        referral_code: agent.referral_code,
        referral_link: agent.referral_link,
        status: agent.status,
        tier: currentTier.name,
        tier_label: currentTier.label,
        tier_rate: currentTier.rate,
        next_tier: TIERS.find(t => t.min > currentTier.min) || null,
        total_referrals: approvedReferralCount,
        total_earnings: totalEarnings,
        pending_earnings: pendingEarnings,
        show_welcome: showWelcome
      },
      earnings,
      all_tiers: TIERS
    });
  } catch (err) {
    console.error('Referral dashboard error:', err);
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

// ─── GET APPLICATION STATUS (by email, no auth needed) ───────────────────────
router.get('/status/:email', (req, res) => {
  try {
    const db = getDB();
    const app = db.prepare(
      'SELECT id, full_name, email, status, payment_status, referral_code, member_number, submitted_at FROM referral_applications WHERE email = ?'
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
