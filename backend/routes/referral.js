const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');

function genMemberNumber() { return 'CTA-' + String(Math.floor(Math.random()*9000)+1000); }

router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, referral_code, motivation } = req.body;
    if (!full_name||!email||!phone||!password||!referral_code) return res.status(400).json({ error: 'All fields including referral code are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check referral code not already taken
    const codeCheck = await query('SELECT id FROM users WHERE referral_code=$1', [referral_code.toUpperCase()]);
    if (codeCheck.rows.length) return res.status(409).json({ error: 'Referral code already taken. Choose another.' });

    // Find or create user
    let user;
    const existing = await query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) {
      user = existing.rows[0];
      if (!user.password_hash) {
        const hash = await bcrypt.hash(password, 10);
        await query('UPDATE users SET password_hash=$1, referral_code=$2 WHERE id=$3', [hash, referral_code.toUpperCase(), user.id]);
      } else {
        await query('UPDATE users SET referral_code=$1 WHERE id=$2 AND referral_code IS NULL', [referral_code.toUpperCase(), user.id]);
      }
    } else {
      const hash = await bcrypt.hash(password, 10);
      const memberNum = genMemberNumber();
      const r = await query(`INSERT INTO users (full_name,email,phone,password_hash,member_number,referral_code,status)
        VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING *`,
        [full_name, email.toLowerCase(), phone, hash, memberNum, referral_code.toUpperCase()]);
      user = r.rows[0];
    }

    // Check existing application
    const appExists = await query('SELECT id FROM referral_applications WHERE user_id=$1 AND status NOT IN ($2)', [user.id, 'rejected']);
    if (appExists.rows.length) {
      const token = generateToken({ id: user.id, email: user.email, type: 'client' });
      const { password_hash, ...safe } = user;
      return res.json({ message: 'Application already submitted', application_id: appExists.rows[0].id, token, user: safe });
    }

    // Create application
    const spots = await query('SELECT total_spots,spots_filled FROM referral_settings WHERE id=1');
    if (spots.rows[0] && spots.rows[0].spots_filled >= spots.rows[0].total_spots) {
      return res.status(400).json({ error: 'No partner spots available at this time' });
    }

    const appResult = await query(`INSERT INTO referral_applications (user_id,full_name,email,phone,motivation,amount)
      VALUES ($1,$2,$3,$4,$5,499) RETURNING *`,
      [user.id, full_name, email.toLowerCase(), phone, motivation||'']);

    const token = generateToken({ id: user.id, email: user.email, type: 'client' });
    const { password_hash, ...safe } = user;
    res.json({ message: 'Application submitted', application_id: appResult.rows[0].id, token, user: safe });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message||'Registration failed' }); }
});

router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const user = (await query('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get application
    const appResult = await query('SELECT * FROM referral_applications WHERE user_id=$1 ORDER BY submitted_at DESC LIMIT 1', [user.id]);
    const application = appResult.rows[0];
    const effectiveApp = application || { id: null, user_id: user.id, status: 'approved', welcomed: true };

    if (!user.has_partner_status && !application) return res.status(404).json({ error: 'No partner application found' });

    // Earnings
    const earnings = await query('SELECT re.*,u.full_name as referred_name,u.email as referred_email FROM referral_earnings re LEFT JOIN users u ON re.referred_user_id=u.id WHERE re.agent_user_id=$1 ORDER BY re.created_at DESC', [user.id]);
    const withdrawals = await query('SELECT * FROM withdrawal_requests WHERE user_id=$1 ORDER BY requested_at DESC', [user.id]);

    // Wallet totals
    const wallet = {
      available: earnings.rows.filter(e=>e.status==='available').reduce((s,e)=>s+e.amount,0),
      pending: earnings.rows.filter(e=>e.status==='pending').reduce((s,e)=>s+e.amount,0),
      paid: earnings.rows.filter(e=>e.status==='paid').reduce((s,e)=>s+e.amount,0),
      lifetime_earned: earnings.rows.reduce((s,e)=>s+e.amount,0),
      total_withdrawn: withdrawals.rows.filter(w=>w.status==='paid').reduce((s,w)=>s+w.amount,0)
    };

    // Tier
    const totalReferrals = earnings.rows.filter(e=>e.commission_type!=='registration').length;
    const settings = (await query('SELECT * FROM referral_settings WHERE id=1')).rows[0];
    const tier = totalReferrals >= (settings?.crown_threshold||10) ? 'crown' : totalReferrals >= (settings?.silver_threshold||5) ? 'silver' : 'bronze';
    const tierLabels = { bronze:'Bronze Partner', silver:'Silver Partner', crown:'Crown Partner' };
    const nextTiers = { bronze:{min:settings?.silver_threshold||5,label:'Silver'}, silver:{min:settings?.crown_threshold||10,label:'Crown'}, crown:null };

    const refLink = `${process.env.FRONTEND_URL||'https://itydee48-oss.github.io/Crowntrade-academy-'}/mentorship-form.html?ref=${user.referral_code}`;

    res.json({
      agent: { id: user.id, full_name: user.full_name, email: user.email, referral_code: user.referral_code, referral_link: refLink,
        tier, tier_label: tierLabels[tier], next_tier: nextTiers[tier], total_referrals: totalReferrals,
        status: effectiveApp.status, wallet },
      earnings: earnings.rows,
      withdrawals: withdrawals.rows
    });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message||'Failed to load dashboard' }); }
});

router.get('/check/:code', async (req, res) => {
  try {
    const r = await query('SELECT full_name FROM users WHERE referral_code=$1', [req.params.code.toUpperCase()]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Invalid referral code' });
    res.json({ valid: true, partner_name: r.rows[0].full_name });
  } catch(err) { res.status(500).json({ error: 'Failed to check code' }); }
});

router.get('/spots', async (req, res) => {
  try {
    const r = await query('SELECT total_spots,spots_filled FROM referral_settings WHERE id=1');
    const s = r.rows[0];
    res.json({ available: (s?.total_spots||100)-(s?.spots_filled||0), total: s?.total_spots||100 });
  } catch(err) { res.status(500).json({ error: 'Failed to get spots' }); }
});

router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, mpesa_number, mpesa_name } = req.body;
    if (!amount||amount<500) return res.status(400).json({ error: 'Minimum withdrawal is KES 500' });
    if (!mpesa_number) return res.status(400).json({ error: 'M-Pesa number required' });
    const r = await query(`INSERT INTO withdrawal_requests (user_id,amount,mpesa_number,mpesa_name) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, amount, mpesa_number, mpesa_name||'']);
    res.json({ message: 'Withdrawal request submitted', request: r.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to submit withdrawal' }); }
});

module.exports = router;
