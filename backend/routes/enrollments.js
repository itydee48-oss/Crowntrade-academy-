const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getDB } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');

// ─── ENROLL IN A COURSE (creates account if new, or adds enrollment if existing) ──
router.post('/enroll', async (req, res) => {
  try {
    const { course_id, full_name, email, phone, password, referred_by_code } = req.body;

    if (!course_id || !full_name || !email || !phone) {
      return res.status(400).json({ error: 'Course, name, email and phone are required' });
    }

    const db = getDB();
    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND is_published = 1').get(course_id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Check if already enrolled in this specific course
    const existingEnrollment = db.prepare(
      "SELECT id FROM enrollments WHERE email = ? AND course_id = ? AND status != 'rejected'"
    ).get(email, course_id);
    if (existingEnrollment) {
      return res.status(409).json({ error: 'You are already enrolled in this course. Try logging in instead.' });
    }

    // Check if this email has an account already (any prior enrollment) to reuse password
    const priorAccount = db.prepare('SELECT password_hash FROM enrollments WHERE email = ? AND password_hash IS NOT NULL LIMIT 1').get(email);

    let password_hash;
    if (priorAccount) {
      // Existing user enrolling in a new course — verify password matches
      if (!password) return res.status(400).json({ error: 'Please enter your existing password to enroll in another course' });
      const valid = await bcrypt.compare(password, priorAccount.password_hash);
      if (!valid) return res.status(401).json({ error: 'Incorrect password for your existing account' });
      password_hash = priorAccount.password_hash;
    } else {
      if (!password || password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      password_hash = await bcrypt.hash(password, 10);
    }

    const countRow = db.prepare('SELECT COUNT(*) as c FROM enrollments').get();
    const member_number = (countRow?.c || 0) + 1;

    const result = db.prepare(`
      INSERT INTO enrollments (full_name, email, phone, password_hash, course_id, member_number, referred_by_code, amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(full_name, email, phone, password_hash, course_id, member_number, referred_by_code || null, course.price);

    // Credit referrer if valid code used
    if (referred_by_code) {
      const referrer = db.prepare(
        'SELECT id FROM referral_applications WHERE referral_code = ? AND status = ?'
      ).get(referred_by_code, 'approved');

      if (referrer) {
        db.prepare(`
          INSERT INTO referral_earnings (referrer_id, referred_email, amount, status, source_type, source_id)
          VALUES (?, ?, ?, 'pending', 'course', ?)
        `).run(referrer.id, email, course.referral_commission || 200, result.lastInsertRowid);
      }
    }

    const token = generateToken({ id: result.lastInsertRowid, email, role: 'client' }, '30d');

    res.status(201).json({
      message: 'Enrollment submitted successfully.',
      enrollment_id: result.lastInsertRowid,
      member_number,
      token,
      user: { id: result.lastInsertRowid, full_name, email, role: 'client', status: 'pending', member_number }
    });
  } catch (err) {
    console.error('Enroll error:', err);
    res.status(500).json({ error: 'Enrollment failed' });
  }
});

// ─── LOGIN (works across all enrollments for this email) ─────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const db = getDB();
    const enrollment = db.prepare(
      'SELECT * FROM enrollments WHERE email = ? AND password_hash IS NOT NULL ORDER BY submitted_at DESC LIMIT 1'
    ).get(email);

    if (!enrollment) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, enrollment.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateToken({ id: enrollment.id, email: enrollment.email, role: 'client' }, '30d');

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: enrollment.id,
        full_name: enrollment.full_name,
        email: enrollment.email,
        role: 'client',
        member_number: enrollment.member_number
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── ATTACH PAYMENT PROOF ─────────────────────────────────────────────────────
router.post('/payment-proof', async (req, res) => {
  try {
    const { email, enrollment_id, proof_url } = req.body;
    if (!email || !proof_url) return res.status(400).json({ error: 'Email and proof URL are required' });

    const db = getDB();
    let target;
    if (enrollment_id) {
      target = db.prepare('SELECT id FROM enrollments WHERE id = ? AND email = ?').get(enrollment_id, email);
    } else {
      target = db.prepare(
        "SELECT id FROM enrollments WHERE email = ? AND status != 'rejected' ORDER BY submitted_at DESC LIMIT 1"
      ).get(email);
    }
    if (!target) return res.status(404).json({ error: 'Enrollment not found' });

    db.prepare(`UPDATE enrollments SET payment_proof = ?, payment_status = 'pending' WHERE id = ?`).run(proof_url, target.id);
    res.json({ message: 'Payment proof submitted. We will verify shortly.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit payment proof' });
  }
});

// ─── GET ALL ENROLLMENTS FOR LOGGED-IN USER (their "My Courses") ────────────
router.get('/my-courses', authenticateToken, (req, res) => {
  try {
    const db = getDB();
    const me = db.prepare('SELECT email FROM enrollments WHERE id = ?').get(req.user.id);
    if (!me) return res.status(404).json({ error: 'Account not found' });

    const enrollments = db.prepare(`
      SELECT e.*, c.title as course_title, c.tagline as course_tagline, c.icon as course_icon, c.thumbnail_url as course_thumbnail, c.slug as course_slug
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE e.email = ?
      ORDER BY e.submitted_at DESC
    `).all(me.email);

    // Welcome flag handling per-enrollment
    const withWelcome = enrollments.map(e => {
      const showWelcome = e.status === 'approved' && e.welcomed === 0;
      if (showWelcome) {
        db.prepare('UPDATE enrollments SET welcomed = 1 WHERE id = ?').run(e.id);
      }
      return { ...e, show_welcome: showWelcome, completed_modules: JSON.parse(e.completed_modules || '[]') };
    });

    res.json({ enrollments: withWelcome });
  } catch (err) {
    console.error('My-courses error:', err);
    res.status(500).json({ error: 'Failed to load your courses' });
  }
});

// ─── GET SINGLE ENROLLMENT DETAIL + MODULES (for course player) ─────────────
router.get('/:id/detail', authenticateToken, (req, res) => {
  try {
    const db = getDB();
    const enrollment = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(req.params.id);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    if (enrollment.email !== req.user.email) return res.status(403).json({ error: 'Not your enrollment' });
    if (enrollment.status !== 'approved') return res.status(403).json({ error: 'Course not yet unlocked' });

    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(enrollment.course_id);
    const modules = db.prepare('SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, module_number ASC').all(enrollment.course_id);

    res.json({
      enrollment: { ...enrollment, completed_modules: JSON.parse(enrollment.completed_modules || '[]') },
      course,
      modules: modules.map(m => ({ ...m, quiz: JSON.parse(m.quiz_json || '[]') }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load course detail' });
  }
});

// ─── MARK MODULE COMPLETE ─────────────────────────────────────────────────────
router.post('/:id/complete-module', authenticateToken, (req, res) => {
  try {
    const { module_id } = req.body;
    const db = getDB();
    const enrollment = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(req.params.id);
    if (!enrollment || enrollment.email !== req.user.email) return res.status(403).json({ error: 'Not your enrollment' });

    const completed = JSON.parse(enrollment.completed_modules || '[]');
    if (!completed.includes(module_id)) {
      completed.push(module_id);
      db.prepare('UPDATE enrollments SET completed_modules = ? WHERE id = ?').run(JSON.stringify(completed), enrollment.id);
    }
    res.json({ message: 'Module marked complete', completed_modules: completed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// ─── STATUS CHECK (no auth — used right after submit) ───────────────────────
router.get('/status/:email', (req, res) => {
  try {
    const db = getDB();
    const enrollments = db.prepare(`
      SELECT e.id, e.status, e.payment_status, e.member_number, c.title as course_title
      FROM enrollments e JOIN courses c ON e.course_id = c.id
      WHERE e.email = ? ORDER BY e.submitted_at DESC
    `).all(req.params.email);
    res.json({ enrollments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

module.exports = router;
