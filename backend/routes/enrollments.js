const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { findOrCreateUser } = require('../database/identity');
const { getTier, FIRST_REFERRAL_BONUS } = require('./referral');

router.post('/enroll', async (req, res) => {
  try {
    const { course_id, full_name, email, phone, password, referred_by_code } = req.body;
    if (!course_id||!full_name||!email||!phone) return res.status(400).json({ error: 'Course, name, email and phone are required' });

    const courseResult = await query('SELECT * FROM courses WHERE id=$1 AND is_published=TRUE', [course_id]);
    const course = courseResult.rows[0];
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const existingUser = await query('SELECT id FROM users WHERE email=$1', [email]);
    const isNew = existingUser.rows.length === 0;

    if (!isNew) {
      const dup = await query(`SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2 AND status!='rejected'`, [existingUser.rows[0].id, course_id]);
      if (dup.rows.length > 0) return res.status(409).json({ error: 'You are already enrolled in this course. Try logging in.' });
    }

    if (isNew && (!password||password.length < 6)) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    if (!isNew && password) {
      const existing = await query('SELECT password_hash FROM users WHERE id=$1', [existingUser.rows[0].id]);
      if (!(await bcrypt.compare(password, existing.rows[0].password_hash)))
        return res.status(401).json({ error: 'Incorrect password for your existing account' });
    }

    const { user } = await findOrCreateUser({ full_name, email, phone, password });
    if (referred_by_code && !user.referred_by_code)
      await query('UPDATE users SET referred_by_code=$1 WHERE id=$2', [referred_by_code, user.id]);

    const result = await query(`INSERT INTO enrollments (user_id,course_id,amount) VALUES ($1,$2,$3) RETURNING *`,
      [user.id, course_id, course.price]);

    // Stage referral commission as pending — admin approval starts the 48hr clock
    if (referred_by_code) {
      const referrerResult = await query('SELECT * FROM users WHERE referral_code=$1 AND has_partner_status=TRUE', [referred_by_code]);
      const referrer = referrerResult.rows[0];
      if (referrer) {
        const priorCount = (await query('SELECT COUNT(*)::int as c FROM referral_earnings WHERE referrer_user_id=$1', [referrer.id])).rows[0].c;
        const isFirst = priorCount === 0;
        const commission = isFirst ? FIRST_REFERRAL_BONUS : getTier(priorCount).rate;
        await query(`
          INSERT INTO referral_earnings (referrer_user_id,referred_email,referred_name,amount,commission_type,status,source_type,source_id)
          VALUES ($1,$2,$3,$4,$5,'pending','enrollment',$6)
        `, [referrer.id, email, full_name, commission, isFirst?'first_referral':'standard', result.rows[0].id]);
      }
    }

    const token = generateToken({ id: user.id, email: user.email, type: 'user' }, '30d');
    res.status(201).json({ message: 'Enrollment submitted successfully.', enrollment_id: result.rows[0].id,
      member_number: user.member_number, token,
      user: { id:user.id, full_name:user.full_name, email:user.email, status:user.status, member_number:user.member_number } });
  } catch (err) {
    console.error('Enroll error:', err);
    res.status(500).json({ error: 'Enrollment failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: 'Email and password are required' });
    const result = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    if (!user||!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    const token = generateToken({ id:user.id, email:user.email, type:'user' }, '30d');
    res.json({ message:'Login successful', token, user:{ id:user.id, full_name:user.full_name, email:user.email, member_number:user.member_number } });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

router.post('/payment-proof', async (req, res) => {
  try {
    const { email, enrollment_id, proof_url } = req.body;
    if (!email||!proof_url) return res.status(400).json({ error: 'Email and proof URL are required' });
    let targetId;
    if (enrollment_id) {
      const r = await query('SELECT e.id FROM enrollments e JOIN users u ON u.id=e.user_id WHERE e.id=$1 AND u.email=$2', [enrollment_id, email]);
      targetId = r.rows[0]?.id;
    } else {
      const r = await query(`SELECT e.id FROM enrollments e JOIN users u ON u.id=e.user_id WHERE u.email=$1 AND e.status!='rejected' ORDER BY e.submitted_at DESC LIMIT 1`, [email]);
      targetId = r.rows[0]?.id;
    }
    if (!targetId) return res.status(404).json({ error: 'Enrollment not found' });
    await query(`UPDATE enrollments SET payment_proof=$1,payment_status='pending' WHERE id=$2`, [proof_url, targetId]);
    res.json({ message: 'Payment proof submitted. We will verify shortly.' });
  } catch (err) { res.status(500).json({ error: 'Failed to submit payment proof' }); }
});

router.get('/my-courses', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT e.*,c.title as course_title,c.tagline as course_tagline,c.icon as course_icon,c.thumbnail_url as course_thumbnail,c.slug as course_slug
      FROM enrollments e JOIN courses c ON e.course_id=c.id WHERE e.user_id=$1 ORDER BY e.submitted_at DESC
    `, [req.user.id]);

    const out = [];
    for (const e of result.rows) {
      const showWelcome = e.status==='approved' && e.welcomed===false;
      if (showWelcome) await query('UPDATE enrollments SET welcomed=TRUE WHERE id=$1', [e.id]);
      out.push({ ...e, show_welcome:showWelcome, completed_modules:JSON.parse(e.completed_modules||'[]') });
    }
    res.json({ enrollments: out });
  } catch (err) {
    console.error('My-courses error:', err);
    res.status(500).json({ error: 'Failed to load your courses' });
  }
});

router.get('/:id/detail', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM enrollments WHERE id=$1', [req.params.id]);
    const enrollment = result.rows[0];
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    if (enrollment.user_id !== req.user.id) return res.status(403).json({ error: 'Not your enrollment' });
    if (enrollment.status !== 'approved') return res.status(403).json({ error: 'Course not yet unlocked' });

    const courseResult = await query('SELECT * FROM courses WHERE id=$1', [enrollment.course_id]);
    const modulesResult = await query('SELECT * FROM course_modules WHERE course_id=$1 ORDER BY sort_order ASC,module_number ASC', [enrollment.course_id]);
    res.json({
      enrollment: { ...enrollment, completed_modules:JSON.parse(enrollment.completed_modules||'[]') },
      course: courseResult.rows[0],
      modules: modulesResult.rows.map(m=>({ ...m, quiz:JSON.parse(m.quiz_json||'[]') }))
    });
  } catch (err) { res.status(500).json({ error: 'Failed to load course detail' }); }
});

router.post('/:id/complete-module', authenticateToken, async (req, res) => {
  try {
    const { module_id } = req.body;
    const result = await query('SELECT * FROM enrollments WHERE id=$1', [req.params.id]);
    const enrollment = result.rows[0];
    if (!enrollment||enrollment.user_id!==req.user.id) return res.status(403).json({ error: 'Not your enrollment' });
    const completed = JSON.parse(enrollment.completed_modules||'[]');
    if (!completed.includes(module_id)) {
      completed.push(module_id);
      await query('UPDATE enrollments SET completed_modules=$1 WHERE id=$2', [JSON.stringify(completed), enrollment.id]);
    }
    res.json({ message:'Module marked complete', completed_modules:completed });
  } catch (err) { res.status(500).json({ error: 'Failed to update progress' }); }
});

router.get('/status/:email', async (req, res) => {
  try {
    const result = await query(`
      SELECT e.id,e.status,e.payment_status,u.member_number,c.title as course_title
      FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON e.course_id=c.id
      WHERE u.email=$1 ORDER BY e.submitted_at DESC
    `, [req.params.email]);
    res.json({ enrollments: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get status' }); }
});

module.exports = router;
