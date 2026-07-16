const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { findOrCreateUser } = require('../database/identity');

router.post('/apply', async (req, res) => {
  try {
    const { full_name, email, phone, password, experience_level, trading_goals, preferred_markets, time_commitment } = req.body;
    if (!full_name || !email || !phone || !experience_level || !trading_goals || !time_commitment)
      return res.status(400).json({ error: 'All required fields must be filled' });

    const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
    const isNew = existingUser.rows.length === 0;
    if (isNew && (!password || password.length < 6)) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    if (!isNew) {
      const dup = await query(`SELECT id FROM mentorship_applications WHERE user_id=$1 AND status!='rejected'`, [existingUser.rows[0].id]);
      if (dup.rows.length > 0) return res.status(409).json({ error: 'You already have an active mentorship application. Try logging in.' });
    }

    const { user } = await findOrCreateUser({ full_name, email, phone, password });
    const marketsStr = Array.isArray(preferred_markets) ? preferred_markets.join(', ') : (preferred_markets || '');

    const result = await query(`
      INSERT INTO mentorship_applications (user_id,experience_level,trading_goals,preferred_markets,time_commitment,amount)
      VALUES ($1,$2,$3,$4,$5,3500) RETURNING *
    `, [user.id, experience_level, trading_goals, marketsStr, time_commitment]);

    const token = generateToken({ id: user.id, email: user.email, type: 'user' }, '30d');
    res.status(201).json({ message: 'Application submitted successfully.', application_id: result.rows[0].id, member_number: user.member_number, token,
      user: { id: user.id, full_name: user.full_name, email: user.email, status: user.status, member_number: user.member_number } });
  } catch (err) {
    console.error('Mentorship apply error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    const token = generateToken({ id: user.id, email: user.email, type: 'user' }, '30d');
    res.json({ message: 'Login successful', token, user: { id: user.id, full_name: user.full_name, email: user.email, status: user.status, member_number: user.member_number } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/payment-proof', async (req, res) => {
  try {
    const { email, proof_url } = req.body;
    if (!email || !proof_url) return res.status(400).json({ error: 'Email and proof URL are required' });
    const result = await query(`
      SELECT ma.id FROM mentorship_applications ma JOIN users u ON u.id=ma.user_id
      WHERE u.email=$1 AND ma.status!='rejected' ORDER BY ma.submitted_at DESC LIMIT 1
    `, [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No application found for this email' });
    await query(`UPDATE mentorship_applications SET payment_proof=$1,payment_status='pending' WHERE id=$2`, [proof_url, result.rows[0].id]);
    res.json({ message: 'Payment proof submitted. We will verify shortly.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit payment proof' });
  }
});

router.get('/status/:email', async (req, res) => {
  try {
    const result = await query(`
      SELECT ma.id,u.full_name,u.email,ma.status,ma.payment_status,ma.payment_proof,u.member_number,ma.submitted_at,ma.admin_notes
      FROM mentorship_applications ma JOIN users u ON u.id=ma.user_id
      WHERE u.email=$1 ORDER BY ma.submitted_at DESC LIMIT 1
    `, [req.params.email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No application found for this email' });
    res.json({ application: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get application status' });
  }
});

router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT ma.*,u.full_name,u.email,u.member_number,u.has_mentorship,u.has_partner_status
      FROM mentorship_applications ma JOIN users u ON u.id=ma.user_id
      WHERE ma.user_id=$1 ORDER BY ma.submitted_at DESC LIMIT 1
    `, [req.user.id]);
    const app = result.rows[0];
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const showWelcome = app.status === 'approved' && app.welcomed === false;
    if (showWelcome) await query('UPDATE mentorship_applications SET welcomed=TRUE WHERE id=$1', [app.id]);
    res.json({ application: { ...app, show_welcome: showWelcome }, user: { email: req.user.email, type: req.user.type } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;
