const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../database/db');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { findOrCreateUser } = require('../database/identity');

router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, referred_by } = req.body;
    if (!full_name || !email || !phone || !password) return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered. Try logging in.' });

    const { user } = await findOrCreateUser({ full_name, email, phone, password });
    if (referred_by) await query('UPDATE users SET referred_by_code=$1 WHERE id=$2', [referred_by, user.id]);

    const token = generateToken({ id: user.id, email: user.email, type: 'user' });
    res.status(201).json({ message: 'Registration successful', token, user: safe(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Unified login — works for every user regardless of registration path
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact support.' });

    const token = generateToken({ id: user.id, email: user.email, type: 'user' }, '30d');
    res.json({ message: 'Login successful', token, user: safe(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const result = await query('SELECT * FROM admin_users WHERE username = $1', [username]);
    const admin = result.rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken({ id: admin.id, username: admin.username, type: 'admin' }, '30d');
    res.json({ message: 'Admin login successful', token, user: { id: admin.id, username: admin.username, type: 'admin' } });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Kept as a separate endpoint for referral-login.html compatibility
router.post('/referral/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.has_partner_status) return res.status(403).json({ error: 'This account does not have an active Crown Partner application.' });

    const token = generateToken({ id: user.id, email: user.email, type: 'user' }, '30d');
    res.json({ message: 'Login successful', token, user: safe(user) });
  } catch (err) {
    console.error('Referral login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    if (req.user.type === 'admin') {
      const result = await query('SELECT id, username, email FROM admin_users WHERE id = $1', [req.user.id]);
      const admin = result.rows[0];
      if (!admin) return res.status(404).json({ error: 'User not found' });
      return res.json({ user: { ...admin, type: 'admin' } });
    }
    const result = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: safe(user) });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

function safe(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

module.exports = router;
