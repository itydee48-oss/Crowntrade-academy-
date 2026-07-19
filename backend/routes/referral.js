const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { findOrCreateUser, grantPartnerStatus } = require('../database/identity');

const TIERS = [
  { name: 'crown',  label: 'Crown Partner',  min: 10, rate: 300, color: '#C8A97E' },
  { name: 'silver', label: 'Silver Partner', min: 5,  rate: 250, color: '#A8A8A8' },
  { name: 'bronze', label: 'Bronze Partner', min: 0,  rate: 200, color: '#CD7F32' }
];
const FIRST_REFERRAL_BONUS = 300;
const MIN_WITHDRAWAL = 500;
const COMMISSION_RELEASE_HOURS = 48;

function getTier(referralCount) { return TIERS.find(t => referralCount >= t.min) || TIERS[TIERS.length - 1]; }
function getNextTier(currentTierName) { const idx = TIERS.findIndex(t => t.name === currentTierName); return idx > 0 ? TIERS[idx - 1] : null; }
function calcCommission(referrerTier, isFirst) {
  if (isFirst) return FIRST_REFERRAL_BONUS;
  return (TIERS.find(t => t.name === referrerTier) || TIERS[TIERS.length - 1]).rate;
}

router.get('/spots', async (req, res) => {
  try {
    const result = await query('SELECT * FROM referral_settings WHERE id=1');
    const s = result.rows[0];
    const remaining = Math.max(0, (s?.total_spots || 50) - (s?.spots_filled || 0));
    res.json({ total_spots: s?.total_spots || 50, spots_filled: s?.spots_filled || 0, spots_remaining: remaining, is_full: remaining <= 0 });
  } catch (err) { res.status(500).json({ error: 'Failed to get spots info' }); }
});

router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, motivation, referred_by_code, payment_proof } = req.body;
    if (!full_name || !email || !phone) return res.status(400).json({ error: 'Name, email and phone are required' });
    if (!payment_proof) return res.status(400).json({ error: 'Payment proof is required' });

    const existingUser = await query('SELECT id FROM users WHERE email=$1', [email]);
    const isNew = existingUser.rows.length === 0;
    if (isNew && (!password || password.length < 6)) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    if (!isNew) {
      const dup = await query(`SELECT id FROM referral_applications WHERE user_id=$1 AND status!='rejected'`, [existingUser.rows[0].id]);
      if (dup.rows.length > 0) return res.status(409).json({ error: 'You already have an active Crown Partner application. Try logging in.' });
    }

    const settings = await query('SELECT * FROM referral_settings WHERE id=1');
    const remaining = (settings.rows[0]?.total_spots || 50) - (settings.rows[0]?.spots_filled || 0);
    if (remaining <= 0) return res.status(403).json({ error: 'All Crown Partner spots are currently filled.' });

    const { user } = await findOrCreateUser({ full_name, email, phone, password });

    if (!user.referral_code) {
      const code = generateReferralCode(full_name);
      await query('UPDATE users SET referral_code=$1,referred_by_code=$2 WHERE id=$3', [code, referred_by_code || null, user.id]);
    }

    const result = await query(`INSERT INTO referral_applications (user_id,motivation,payment_proof,amount) VALUES ($1,$2,$3,500) RETURNING *`,
      [user.id, motivation || null, payment_proof]);

    const token = generateToken({ id: user.id, email: user.email, type: 'user' }, '30d');
    res.status(201).json({ message: 'Application submitted! Log in anytime to check your status.', application_id: result.rows[0].id,
      member_number: user.member_number, token,
      user: { id: user.id, full_name: user.full_name, email: user.email, status: user.status, member_number: user.member_number } });
  } catch (err) {
    console.error('Referral register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const result = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    const token = generateToken({ id: user.id, email: user.email, type: 'user' }, '30d');
    res.json({ message: 'Login successful', token,
      user: { id: user.id, full_name: user.full_name, email: user.email, status: user.status, member_number: user.member_number, tier: user.partner_tier, referral_code: user.referral_code } });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const appResult = await query('SELECT * FROM referral_applications WHERE user_id=$1 ORDER BY submitted_at DESC LIMIT 1', [req.user.id]);
    const application = appResult.rows[0];

    // A user can have has_partner_status=true without a referral_applications row
    // if they became a partner via mentorship approval (auto-grant path).
    // In that case, synthesise a minimal application object from the users row
    // so the dashboard still renders their wallet and earnings correctly.
    const effectiveApp = application || {
      id: null,
      user_id: user.id,
      status: 'approved',
      welcomed: true,
      amount: null,
      payment_status: null
    };
    if (!application && !user.has_partner_status) {
      return res.status(404).json({ error: 'No partner application found' });
    }

    const now = new Date();
    const earningsResult = await query('SELECT * FROM referral_earnings WHERE referrer_user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    const earnings = earningsResult.rows;

    const available = earnings.filter(e => e.status==='available'||(e.status==='pending'&&e.available_after&&new Date(e.available_after)<=now)).reduce((s,e)=>s+e.amount,0);
    const pending = earnings.filter(e => e.status==='pending'&&(!e.available_after||new Date(e.available_after)>now)).reduce((s,e)=>s+e.amount,0);
    const lifetimeEarned = earnings.filter(e => ['available','paid'].includes(e.status)||(e.status==='pending'&&e.available_after&&new Date(e.available_after)<=now)).reduce((s,e)=>s+e.amount,0);

    const wResult = await query('SELECT * FROM withdrawal_requests WHERE referrer_user_id=$1 ORDER BY requested_at DESC', [req.user.id]);
    const withdrawals = wResult.rows;
    const totalWithdrawn = withdrawals.filter(w=>w.status==='paid').reduce((s,w)=>s+w.amount,0);

    const approvedReferrals = earnings.length;
    const currentTier = getTier(approvedReferrals);
    const nextTier = getNextTier(currentTier.name);

    if (user.partner_tier !== currentTier.name) await query('UPDATE users SET partner_tier=$1 WHERE id=$2', [currentTier.name, user.id]);

    const showWelcome = effectiveApp.status==='approved' && effectiveApp.welcomed===false;
    if (showWelcome && effectiveApp.id) await query('UPDATE referral_applications SET welcomed=TRUE WHERE id=$1', [effectiveApp.id]);

    const lbResult = await query(`
      SELECT u.id,
        SUM(CASE WHEN re.status IN ('available','paid') THEN re.amount
                 WHEN re.status='pending' AND re.available_after IS NOT NULL AND re.available_after<=NOW() THEN re.amount ELSE 0 END) as total_earned
      FROM users u LEFT JOIN referral_earnings re ON re.referrer_user_id=u.id
      WHERE u.has_partner_status=TRUE GROUP BY u.id ORDER BY total_earned DESC LIMIT 10
    `);
    const leaderboard = lbResult.rows;
    const myRank = leaderboard.findIndex(l=>l.id===user.id)+1;

    res.json({
      agent: { id:user.id,member_number:user.member_number,full_name:user.full_name,email:user.email,phone:user.phone,
        referral_code:user.referral_code,
        referral_link:`${process.env.FRONTEND_URL||'https://itydee48-oss.github.io/crowntraders-academy'}/referral-register.html?ref=${user.referral_code}`,
        status:effectiveApp.status,tier:currentTier.name,tier_label:currentTier.label,tier_rate:currentTier.rate,tier_color:currentTier.color,
        next_tier:nextTier,total_referrals:approvedReferrals,has_mentorship:user.has_mentorship,
        wallet:{ available:Math.max(0,available-totalWithdrawn),pending,lifetime_earned:lifetimeEarned+totalWithdrawn,total_withdrawn:totalWithdrawn },
        show_welcome:showWelcome, rank:myRank||null },
      earnings, withdrawals,
      leaderboard:leaderboard.map((l,i)=>({rank:i+1,is_me:l.id===user.id,total_earned:Number(l.total_earned)||0})),
      tiers:TIERS, min_withdrawal:MIN_WITHDRAWAL
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, mpesa_number, mpesa_name } = req.body;
    if (!amount||!mpesa_number) return res.status(400).json({ error: 'Amount and M-Pesa number are required' });
    if (amount < MIN_WITHDRAWAL) return res.status(400).json({ error: `Minimum withdrawal is KES ${MIN_WITHDRAWAL}` });

    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user||!user.has_partner_status) return res.status(403).json({ error: 'Account not approved for withdrawals' });

    const pendingW = await query(`SELECT id FROM withdrawal_requests WHERE referrer_user_id=$1 AND status='pending'`, [req.user.id]);
    if (pendingW.rows.length > 0) return res.status(409).json({ error: 'You already have a pending withdrawal request.' });

    const now = new Date();
    const eResult = await query('SELECT * FROM referral_earnings WHERE referrer_user_id=$1', [req.user.id]);
    const available = eResult.rows.filter(e=>e.status==='available'||(e.status==='pending'&&e.available_after&&new Date(e.available_after)<=now)).reduce((s,e)=>s+e.amount,0);
    const wResult = await query(`SELECT COALESCE(SUM(amount),0)::int as s FROM withdrawal_requests WHERE referrer_user_id=$1 AND status='paid'`, [req.user.id]);
    const walletBalance = available - Number(wResult.rows[0].s);

    if (amount > walletBalance) return res.status(400).json({ error: `Insufficient balance. Available: KES ${walletBalance}` });

    const result = await query(`INSERT INTO withdrawal_requests (referrer_user_id,amount,mpesa_number,mpesa_name) VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.user.id, amount, mpesa_number, mpesa_name||null]);
    res.status(201).json({ message: 'Withdrawal request submitted. Admin will process within 48 hours.', request_id: result.rows[0].id });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Failed to submit withdrawal request' });
  }
});

router.get('/check/:code', async (req, res) => {
  try {
    const result = await query('SELECT full_name,referral_code FROM users WHERE referral_code=$1 AND has_partner_status=TRUE', [req.params.code]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ valid: false, message: 'Invalid referral code' });
    res.json({ valid: true, referrer_name: user.full_name });
  } catch (err) { res.status(500).json({ error: 'Failed to check referral code' }); }
});

router.get('/status/:email', async (req, res) => {
  try {
    const result = await query(`
      SELECT ra.id,u.full_name,u.email,ra.status,ra.payment_status,u.referral_code,u.member_number,ra.submitted_at
      FROM referral_applications ra JOIN users u ON u.id=ra.user_id
      WHERE u.email=$1 ORDER BY ra.submitted_at DESC LIMIT 1
    `, [req.params.email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No application found' });
    res.json({ application: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to get status' }); }
});

function generateReferralCode(name) {
  const base = name.replace(/\s+/g,'').toUpperCase().slice(0,4);
  const rand = Math.random().toString(36).substring(2,6).toUpperCase();
  return `${base}${rand}`;
}

module.exports = { router, getTier, getNextTier, calcCommission, FIRST_REFERRAL_BONUS, COMMISSION_RELEASE_HOURS, TIERS };
