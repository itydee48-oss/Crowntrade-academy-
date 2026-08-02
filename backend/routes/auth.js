const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { generateToken, authenticateToken } = require('../middleware/auth');

function genMemberNumber() { return 'CTA-' + String(Math.floor(Math.random()*9000)+1000); }
function genReferralCode(name) { return (name.replace(/\s+/g,'').toUpperCase().substring(0,5) + Math.floor(Math.random()*9000+1000)); }

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password } = req.body;
    if (!full_name||!email||!password) return res.status(400).json({ error: 'Name, email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const exists = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Account with this email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const memberNum = genMemberNumber();
    const refCode = genReferralCode(full_name);
    const result = await query(`INSERT INTO users (full_name,email,phone,password_hash,member_number,referral_code,status)
      VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING *`,
      [full_name, email.toLowerCase(), phone||'', hash, memberNum, refCode]);
    const user = result.rows[0];
    const token = generateToken({ id: user.id, email: user.email, type: 'client' });
    const { password_hash, ...safe } = user;
    res.json({ message: 'Account created', token, user: safe });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Registration failed' }); }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: 'Email and password required' });
    const result = await query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.password_hash) return res.status(401).json({ error: 'Please set a password via the registration form' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact support.' });

    // Update login streak
    const today = new Date().toISOString().split('T')[0];
    const lastDate = user.login_last_date ? new Date(user.login_last_date).toISOString().split('T')[0] : null;
    let newStreak = user.login_streak || 0;
    if (lastDate === today) { /* same day, no change */ }
    else if (lastDate && new Date(today) - new Date(lastDate) <= 86400000) { newStreak += 1; }
    else { newStreak = 1; }
    await query('UPDATE users SET login_streak=$1, login_last_date=$2 WHERE id=$3', [newStreak, today, user.id]);

    const token = generateToken({ id: user.id, email: user.email, type: 'client' });

    // Get mentor info if assigned
    let mentorInfo = {};
    if (user.mentor_id) {
      const mResult = await query('SELECT id,full_name,display_name,bio,avatar_url,phone FROM mentors WHERE id=$1', [user.mentor_id]);
      const m = mResult.rows[0];
      if (m) mentorInfo = { mentor_display_name: m.display_name||m.full_name, mentor_bio: m.bio, mentor_avatar: m.avatar_url, mentor_phone: m.phone };
    }

    const { password_hash, ...safe } = user;
    res.json({ message: 'Login successful', token, user: { ...safe, ...mentorInfo, login_streak: newStreak } });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Login failed' }); }
});

// ADMIN LOGIN
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username||!password) return res.status(400).json({ error: 'Username and password required' });
    const result = await query('SELECT * FROM admin_users WHERE username=$1', [username]);
    const admin = result.rows[0];
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = generateToken({ id: admin.id, username: admin.username, type: 'admin' });
    res.json({ message: 'Admin login successful', token, user: { id: admin.id, username: admin.username, email: admin.email, type: 'admin' } });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Login failed' }); }
});

// GET ME
router.get('/me', authenticateToken, async (req, res) => {
  try {
    if (req.user.type === 'admin') {
      const r = await query('SELECT id,username,email FROM admin_users WHERE id=$1', [req.user.id]);
      return res.json({ user: { ...r.rows[0], type: 'admin' } });
    }
    if (req.user.type === 'mentor') {
      const r = await query('SELECT id,full_name,display_name,email,phone,bio,avatar_url,status FROM mentors WHERE id=$1', [req.user.id]);
      return res.json({ user: { ...r.rows[0], type: 'mentor' } });
    }
    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    let mentorInfo = {};
    if (r.rows[0].mentor_id) {
      const m = await query('SELECT full_name,display_name,bio,avatar_url,phone FROM mentors WHERE id=$1', [r.rows[0].mentor_id]);
      if (m.rows[0]) mentorInfo = { mentor_display_name: m.rows[0].display_name||m.rows[0].full_name, mentor_bio: m.rows[0].bio, mentor_avatar: m.rows[0].avatar_url, mentor_phone: m.rows[0].phone };
    }
    const { password_hash, ...safe } = r.rows[0];
    res.json({ user: { ...safe, ...mentorInfo, type: 'client' } });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get user' }); }
});

// UPDATE PROFILE
router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    const { full_name, phone } = req.body;
    await query('UPDATE users SET full_name=COALESCE($1,full_name), phone=COALESCE($2,phone), updated_at=CURRENT_TIMESTAMP WHERE id=$3',
      [full_name||null, phone||null, req.user.id]);
    res.json({ message: 'Profile updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update profile' }); }
});

// CHANGE PASSWORD
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password||!new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const r = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, r.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to change password' }); }
});

// HEALTH
router.get('/health', (req, res) => res.json({ status: 'ok', message: 'Crown Trade Academy API running', jwt_secret_set: !!process.env.JWT_SECRET, node_version: process.version }));

module.exports = router;
