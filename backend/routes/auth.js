const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getDB } = require('../database/db');
const { generateToken, authenticateToken } = require('../middleware/auth');

// ─── CLIENT REGISTER ─────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, phone, password, referred_by } = req.body;

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const referral_code = generateReferralCode(full_name);

    const result = db.prepare(`
      INSERT INTO users (full_name, email, phone, password_hash, role, status, referral_code, referred_by)
      VALUES (?, ?, ?, ?, 'client', 'active', ?, ?)
    `).run(full_name, email, phone, password_hash, referral_code, referred_by || null);

    const token = generateToken({ id: result.lastInsertRowid, email, role: 'client' });

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: result.lastInsertRowid, full_name, email, role: 'client', referral_code }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── CLIENT LOGIN ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = getDB();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, status: user.status }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── ADMIN LOGIN ──────────────────────────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDB();
    const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);

    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ id: admin.id, username: admin.username, role: 'admin' }, '1d');

    res.json({
      message: 'Admin login successful',
      token,
      user: { id: admin.id, username: admin.username, role: 'admin' }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── REFERRAL AGENT LOGIN ─────────────────────────────────────────────────────
router.post('/referral/login', async (req, res) => {
  try {
    const { email, referral_code } = req.body;
    if (!email || !referral_code) {
      return res.status(400).json({ error: 'Email and referral code are required' });
    }

    const db = getDB();
    const agent = db.prepare(
      'SELECT * FROM referral_applications WHERE email = ? AND referral_code = ?'
    ).get(email, referral_code);

    if (!agent) {
      return res.status(401).json({ error: 'Invalid email or referral code' });
    }
    if (agent.status !== 'approved') {
      return res.status(403).json({ error: 'Your referral account is pending approval' });
    }

    const token = generateToken({ id: agent.id, email: agent.email, role: 'referral' }, '7d');

    res.json({
      message: 'Login successful',
      token,
      user: { id: agent.id, full_name: agent.full_name, email: agent.email, referral_code: agent.referral_code, role: 'referral' }
    });
  } catch (err) {
    console.error('Referral login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET CURRENT USER ─────────────────────────────────────────────────────────
router.get('/me', authenticateToken, (req, res) => {
  try {
    const db = getDB();
    let user;

    if (req.user.role === 'admin') {
      user = db.prepare('SELECT id, username, email FROM admin_users WHERE id = ?').get(req.user.id);
      if (user) user.role = 'admin';
    } else if (req.user.role === 'referral') {
      user = db.prepare('SELECT id, full_name, email, phone, referral_code, status, earnings FROM referral_applications WHERE id = ?').get(req.user.id);
      if (user) user.role = 'referral';
    } else {
      user = db.prepare('SELECT id, full_name, email, phone, role, status, referral_code FROM users WHERE id = ?').get(req.user.id);
    }

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ─── HELPER ───────────────────────────────────────────────────────────────────
function generateReferralCode(name) {
  const base = name.replace(/\s+/g, '').toUpperCase().slice(0, 4);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${base}${rand}`;
}

module.exports = router;
