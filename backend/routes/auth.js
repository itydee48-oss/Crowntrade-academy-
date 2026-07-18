const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../database/db');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { findOrCreateUser } = require('../database/identity');

async function updateLoginStreak(userId) {
  const result = await query('SELECT login_streak,login_last_date FROM users WHERE id=$1', [userId]);
  const user = result.rows[0];
  const today = new Date().toISOString().slice(0,10);
  const last = user.login_last_date ? new Date(user.login_last_date).toISOString().slice(0,10) : null;
  if (last === today) return;
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  const streak = last === yesterday ? (user.login_streak||0) + 1 : 1;
  await query('UPDATE users SET login_streak=$1,login_last_date=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3', [streak, today, userId]);
}

router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, referred_by } = req.body;
    if (!full_name||!email||!phone||!password) return res.status(400).json({ error:'All fields are required' });
    if (password.length < 6) return res.status(400).json({ error:'Password must be at least 6 characters' });
    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error:'Email already registered. Try logging in.' });
    const { user } = await findOrCreateUser({ full_name, email, phone, password });
    if (referred_by) await query('UPDATE users SET referred_by_code=$1 WHERE id=$2', [referred_by, user.id]);
    const token = generateToken({ id:user.id, email:user.email, type:'user' });
    res.status(201).json({ message:'Registration successful', token, user:safe(user) });
  } catch (err) { console.error('Register error:', err); res.status(500).json({ error:'Registration failed' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error:'Email and password are required' });
    const result = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user||!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error:'Invalid email or password' });
    if (user.status==='suspended') return res.status(403).json({ error:'Account suspended. Contact support.' });
    await updateLoginStreak(user.id);
    const token = generateToken({ id:user.id, email:user.email, type:'user' }, '30d');
    res.json({ message:'Login successful', token, user:safe(user) });
  } catch (err) { console.error('Login error:', err); res.status(500).json({ error:'Login failed' }); }
});

router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username||!password) return res.status(400).json({ error:'Username and password are required' });
    const result = await query('SELECT * FROM admin_users WHERE username=$1', [username]);
    const admin = result.rows[0];
    if (!admin||!(await bcrypt.compare(password, admin.password_hash))) return res.status(401).json({ error:'Invalid credentials' });
    const token = generateToken({ id:admin.id, username:admin.username, type:'admin' }, '30d');
    res.json({ message:'Admin login successful', token, user:{ id:admin.id, username:admin.username, type:'admin' } });
  } catch (err) { console.error('Admin login error:', err); res.status(500).json({ error:'Login failed' }); }
});

router.post('/referral/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error:'Email and password are required' });
    const result = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user||!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error:'Invalid email or password' });
    if (!user.has_partner_status) return res.status(403).json({ error:'This account does not have an active Crown Partner application.' });
    await updateLoginStreak(user.id);
    const token = generateToken({ id:user.id, email:user.email, type:'user' }, '30d');
    res.json({ message:'Login successful', token, user:safe(user) });
  } catch (err) { console.error('Referral login error:', err); res.status(500).json({ error:'Login failed' }); }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    if (req.user.type==='admin') {
      const result = await query('SELECT id,username,email FROM admin_users WHERE id=$1', [req.user.id]);
      if (!result.rows[0]) return res.status(404).json({ error:'User not found' });
      return res.json({ user:{ ...result.rows[0], type:'admin' } });
    }
    if (req.user.type==='mentor') {
      const result = await query('SELECT id,full_name,display_name,email,phone,bio,avatar_url,status FROM mentors WHERE id=$1', [req.user.id]);
      if (!result.rows[0]) return res.status(404).json({ error:'Mentor not found' });
      return res.json({ user:{ ...result.rows[0], type:'mentor' } });
    }
    const result = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error:'User not found' });
    res.json({ user:safe(result.rows[0]) });
  } catch (err) { console.error('Me error:', err); res.status(500).json({ error:'Failed to get user' }); }
});

// Profile update for clients
router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    if (req.user.type !== 'user') return res.status(403).json({ error:'Not a client account' });
    const { full_name, phone } = req.body;
    await query('UPDATE users SET full_name=COALESCE($1,full_name),phone=COALESCE($2,phone),updated_at=CURRENT_TIMESTAMP WHERE id=$3',
      [full_name||null, phone||null, req.user.id]);
    res.json({ message:'Profile updated' });
  } catch (err) { res.status(500).json({ error:'Failed to update profile' }); }
});

// Change password for clients
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    if (req.user.type !== 'user') return res.status(403).json({ error:'Not a client account' });
    const { current_password, new_password } = req.body;
    if (!current_password||!new_password) return res.status(400).json({ error:'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error:'New password must be at least 6 characters' });
    const result = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(current_password, result.rows[0].password_hash))) return res.status(401).json({ error:'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2', [hash, req.user.id]);
    res.json({ message:'Password updated' });
  } catch (err) { res.status(500).json({ error:'Failed to change password' }); }
});

function safe(user) { const { password_hash, ...rest } = user; return rest; }

module.exports = router;
