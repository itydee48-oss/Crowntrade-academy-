const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { generateToken } = require('../middleware/auth');

function genMemberNumber() { return 'CTA-' + String(Math.floor(Math.random()*9000)+1000); }
function genReferralCode(name) { return (name.replace(/\s+/g,'').toUpperCase().substring(0,5) + Math.floor(Math.random()*9000+1000)); }

router.post('/apply', async (req, res) => {
  try {
    const { full_name, email, phone, password, experience_level, preferred_markets, time_commitment, trading_goals, referral_code } = req.body;
    if (!full_name||!email||!phone||!password) return res.status(400).json({ error: 'Name, email, phone and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Find or create user
    let user;
    const existing = await query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) {
      user = existing.rows[0];
      // Update password if not set
      if (!user.password_hash) {
        const hash = await bcrypt.hash(password, 10);
        await query('UPDATE users SET password_hash=$1, full_name=$2, phone=$3 WHERE id=$4', [hash, full_name, phone, user.id]);
        user.password_hash = hash;
      }
    } else {
      const hash = await bcrypt.hash(password, 10);
      const memberNum = genMemberNumber();
      const refCode = genReferralCode(full_name);
      const r = await query(`INSERT INTO users (full_name,email,phone,password_hash,member_number,referral_code,status)
        VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING *`,
        [full_name, email.toLowerCase(), phone, hash, memberNum, refCode]);
      user = r.rows[0];
    }

    // Check for existing pending application
    const appExists = await query('SELECT id FROM mentorship_applications WHERE user_id=$1 AND status NOT IN ($2)', [user.id, 'rejected']);
    if (appExists.rows.length) {
      const token = generateToken({ id: user.id, email: user.email, type: 'client' });
      const { password_hash, ...safe } = user;
      return res.json({ message: 'Application already submitted', application_id: appExists.rows[0].id, token, user: safe });
    }

    // Validate referral code
    let referredByCode = null;
    if (referral_code) {
      const refCheck = await query('SELECT user_id FROM users WHERE referral_code=$1', [referral_code.toUpperCase()]);
      if (refCheck.rows.length) referredByCode = referral_code.toUpperCase();
    }
    if (referredByCode) await query('UPDATE users SET referred_by_code=$1 WHERE id=$2 AND referred_by_code IS NULL', [referredByCode, user.id]);

    const appResult = await query(`INSERT INTO mentorship_applications
      (user_id,full_name,email,phone,experience_level,preferred_markets,time_commitment,trading_goals,referral_code,amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,999) RETURNING *`,
      [user.id, full_name, email.toLowerCase(), phone, experience_level||'', preferred_markets||'', time_commitment||'', trading_goals||'', referredByCode||'']);

    const token = generateToken({ id: user.id, email: user.email, type: 'client' });
    const { password_hash, ...safe } = user;
    res.json({ message: 'Application submitted', application_id: appResult.rows[0].id, token, user: safe });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message||'Application failed' }); }
});

router.get('/status/:email', async (req, res) => {
  try {
    const r = await query('SELECT status,payment_status,submitted_at FROM mentorship_applications WHERE email=$1 ORDER BY submitted_at DESC LIMIT 1', [req.params.email]);
    if (!r.rows[0]) return res.status(404).json({ error: 'No application found' });
    res.json({ application: r.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to get status' }); }
});

module.exports = router;
