const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getDB } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');

// ─── TIER CONFIG ──────────────────────────────────────────────────────────────
const TIERS = [
  { name: 'crown',  label: 'Crown Partner',  min: 10, rate: 300, color: '#C8A97E' },
  { name: 'silver', label: 'Silver Partner', min: 5,  rate: 250, color: '#A8A8A8' },
  { name: 'bronze', label: 'Bronze Partner', min: 0,  rate: 200, color: '#CD7F32' }
];
const FIRST_REFERRAL_BONUS = 300;
const MIN_WITHDRAWAL = 500;
const COMMISSION_RELEASE_HOURS = 48;

function getTier(referralCount) {
  return TIERS.find(t => referralCount >= t.min) || TIERS[TIERS.length - 1];
}

function getNextTier(currentTierName) {
  const idx = TIERS.findIndex(t => t.name === currentTierName);
  return idx > 0 ? TIERS[idx - 1] : null;
}

function calcCommission(referrerTier, isFirst) {
  if (isFirst) return FIRST_REFERRAL_BONUS;
  const tier = TIERS.find(t => t.name === referrerTier) || TIERS[TIERS.length - 1];
  return tier.rate;
}

// ─── SPOTS REMAINING ─────────────────────────────────────────────────────────
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

// ─── REGISTER ────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, motivation, referred_by_code, payment_proof } = req.body;

    if (!full_name || !email || !phone || !password)
      return res.status(400).json({ error: 'Name, email, phone and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!payment_proof)
      return res.status(400).json({ error: 'Payment proof is required' });

    const db = getDB();
    const existing = db.prepare('SELECT id FROM referral_applications WHERE email = ?').get(email);
    if (existing)
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in.' });

    const settings = db.prepare('SELECT * FROM referral_settings WHERE id = 1').get();
    const remaining = (settings?.total_spots || 50) - (settings?.spots_filled || 0);
    if (remaining <= 0)
      return res.status(403).json({ error: 'All Crown Partner spots are currently filled. Email us to join the waitlist.' });

    const password_hash = await bcrypt.hash(password, 10);
    const referral_code = generateReferralCode(full_name);
    const referral_link = `${process.env.FRONTEND_URL || 'https://itydee48-oss.github.io/crowntraders-academy'}/referral-register.html?ref=${referral_code}`;

    const countRow = db.prepare('SELECT COUNT(*) as c FROM referral_applications').get();
    const member_number = (countRow?.c || 0) + 1;

    const result = db.prepare(`
      INSERT INTO referral_applications
        (member_number, full_name, email, phone, password_hash, motivation, referred_by_code, payment_proof, referral_code, referral_link, amount, tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 500, 'bronze')
    `).run(member_number, full_name, email, phone, password_hash, motivation || null, referred_by_code || null, payment_proof, referral_code, referral_link);

    const token = generateToken({ id: result.lastInsertRowid, email, role: 'referral' }, '30d');

    res.status(201).json({
      message: 'Application submitted! Log in anytime to check your status.',
      application_id: result.lastInsertRowid,
      member_number,
      token,
      user: { id: result.lastInsertRowid, full_name, email, role: 'referral', status: 'pending', member_number }
    });
  } catch (err) {
    console.error('Referral register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const db = getDB();
    const agent = db.prepare('SELECT * FROM referral_applications WHERE email = ?').get(email);

    if (!agent || !agent.password_hash)
      return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    if (agent.status === 'rejected')
      return res.status(403).json({ error: 'Your application was not approved. Contact support.' });

    const token = generateToken({ id: agent.id, email: agent.email, role: 'referral' }, '30d');

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: agent.id, full_name: agent.full_name, email: agent.email,
        role: 'referral', status: agent.status,
        member_number: agent.member_number, tier: agent.tier,
        referral_code: agent.referral_code
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    const db = getDB();
    const agent = db.prepare('SELECT * FROM referral_applications WHERE id = ?').get(req.user.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const now = new Date();
    const earnings = db.prepare(
      'SELECT * FROM referral_earnings WHERE referrer_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);

    // Wallet calculation
    const available = earnings
      .filter(e => e.status === 'available' || (e.status === 'pending' && e.available_after && new Date(e.available_after) <= now))
      .reduce((s, e) => s + e.amount, 0);
    const pending = earnings
      .filter(e => e.status === 'pending' && (!e.available_after || new Date(e.available_after) > now))
      .reduce((s, e) => s + e.amount, 0);
    const lifetimeEarned = earnings
      .filter(e => ['available','paid'].includes(e.status) || (e.status === 'pending' && e.available_after && new Date(e.available_after) <= now))
      .reduce((s, e) => s + e.amount, 0);

    const withdrawals = db.prepare(
      'SELECT * FROM withdrawal_requests WHERE referrer_id = ? ORDER BY requested_at DESC'
    ).all(req.user.id);
    const totalWithdrawn = withdrawals.filter(w => w.status === 'paid').reduce((s, w) => s + w.amount, 0);

    const approvedReferrals = earnings.length;
    const currentTier = getTier(approvedReferrals);
    const nextTier = getNextTier(currentTier.name);

    // Auto-update tier if changed
    if (agent.tier !== currentTier.name) {
      db.prepare('UPDATE referral_applications SET tier = ? WHERE id = ?').run(currentTier.name, agent.id);
    }

    const showWelcome = agent.status === 'approved' && agent.welcomed === 0;
    if (showWelcome) {
      db.prepare('UPDATE referral_applications SET welcomed = 1 WHERE id = ?').run(agent.id);
    }

    // Leaderboard — ranks only, no names or total count
    const leaderboard = db.prepare(`
      SELECT ra.id,
        SUM(CASE WHEN re.status IN ('available','paid') THEN re.amount
                 WHEN re.status = 'pending' AND re.available_after IS NOT NULL AND re.available_after <= datetime('now') THEN re.amount
                 ELSE 0 END) as total_earned
      FROM referral_applications ra
      LEFT JOIN referral_earnings re ON re.referrer_id = ra.id
      WHERE ra.status = 'approved'
      GROUP BY ra.id
      ORDER BY total_earned DESC
      LIMIT 10
    `).all();

    const myRank = leaderboard.findIndex(l => l.id === agent.id) + 1;

    res.json({
      agent: {
        id: agent.id, member_number: agent.member_number,
        full_name: agent.full_name, email: agent.email, phone: agent.phone,
        referral_code: agent.referral_code, referral_link: agent.referral_link,
        status: agent.status, tier: currentTier.name,
        tier_label: currentTier.label, tier_rate: currentTier.rate, tier_color: currentTier.color,
        next_tier: nextTier, total_referrals: approvedReferrals,
        wallet: {
          available: available - totalWithdrawn < 0 ? 0 : available - totalWithdrawn,
          pending, lifetime_earned: lifetimeEarned + totalWithdrawn,
          total_withdrawn: totalWithdrawn
        },
        show_welcome: showWelcome,
        rank: myRank || null
      },
      earnings,
      withdrawals,
      leaderboard: leaderboard.map((l, i) => ({
        rank: i + 1,
        is_me: l.id === agent.id,
        total_earned: l.total_earned || 0
      })),
      tiers: TIERS,
      min_withdrawal: MIN_WITHDRAWAL
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─── REQUEST WITHDRAWAL ───────────────────────────────────────────────────────
router.post('/withdraw', authenticateToken, (req, res) => {
  try {
    const { amount, mpesa_number, mpesa_name } = req.body;
    if (!amount || !mpesa_number)
      return res.status(400).json({ error: 'Amount and M-Pesa number are required' });
    if (amount < MIN_WITHDRAWAL)
      return res.status(400).json({ error: `Minimum withdrawal is KES ${MIN_WITHDRAWAL}` });

    const db = getDB();
    const agent = db.prepare('SELECT * FROM referral_applications WHERE id = ?').get(req.user.id);
    if (!agent || agent.status !== 'approved')
      return res.status(403).json({ error: 'Account not approved for withdrawals' });

    // Check no pending withdrawal already exists
    const pendingWithdrawal = db.prepare(
      "SELECT id FROM withdrawal_requests WHERE referrer_id = ? AND status = 'pending'"
    ).get(req.user.id);
    if (pendingWithdrawal)
      return res.status(409).json({ error: 'You already have a pending withdrawal request. Wait for it to be processed.' });

    // Calculate available balance
    const now = new Date();
    const earnings = db.prepare('SELECT * FROM referral_earnings WHERE referrer_id = ?').all(req.user.id);
    const available = earnings
      .filter(e => e.status === 'available' || (e.status === 'pending' && e.available_after && new Date(e.available_after) <= now))
      .reduce((s, e) => s + e.amount, 0);
    const withdrawn = db.prepare(
      "SELECT COALESCE(SUM(amount),0) as s FROM withdrawal_requests WHERE referrer_id = ? AND status = 'paid'"
    ).get(req.user.id).s;
    const walletBalance = available - withdrawn;

    if (amount > walletBalance)
      return res.status(400).json({ error: `Insufficient balance. Available: KES ${walletBalance}` });

    const result = db.prepare(`
      INSERT INTO withdrawal_requests (referrer_id, amount, mpesa_number, mpesa_name)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, amount, mpesa_number, mpesa_name || null);

    res.status(201).json({
      message: 'Withdrawal request submitted. Admin will process within 48 hours.',
      request_id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Failed to submit withdrawal request' });
  }
});

// ─── CHECK REFERRAL CODE ──────────────────────────────────────────────────────
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

// ─── STATUS CHECK ─────────────────────────────────────────────────────────────
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

function generateReferralCode(name) {
  const base = name.replace(/\s+/g, '').toUpperCase().slice(0, 4);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${base}${rand}`;
}

module.exports = { router, getTier, getNextTier, calcCommission, FIRST_REFERRAL_BONUS, COMMISSION_RELEASE_HOURS, TIERS };
