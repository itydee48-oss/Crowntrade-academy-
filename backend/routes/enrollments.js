const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { authenticateToken, generateToken } = require('../middleware/auth');

function genMemberNumber() { return 'CTA-' + String(Math.floor(Math.random()*9000)+1000); }

// ENROLL IN COURSE
router.post('/enroll', async (req, res) => {
  try {
    const { course_id, full_name, email, phone, password, referred_by_code } = req.body;
    if (!course_id||!full_name||!email) return res.status(400).json({ error: 'Course, name and email required' });

    // Get course
    const courseResult = await query('SELECT * FROM courses WHERE id=$1 AND is_published=TRUE', [course_id]);
    const course = courseResult.rows[0];
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Find or create user
    let user;
    const existing = await query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) {
      user = existing.rows[0];
    } else {
      if (!password || password.length < 6) return res.status(400).json({ error: 'Password required (min 6 chars) for new accounts' });
      const hash = await bcrypt.hash(password, 10);
      const memberNum = genMemberNumber();
      const r = await query(`INSERT INTO users (full_name,email,phone,password_hash,member_number,status)
        VALUES ($1,$2,$3,$4,$5,'active') RETURNING *`,
        [full_name, email.toLowerCase(), phone||'', hash, memberNum]);
      user = r.rows[0];
    }

    // Check already enrolled
    const enrollExists = await query('SELECT * FROM enrollments WHERE user_id=$1 AND course_id=$2', [user.id, course_id]);
    if (enrollExists.rows.length) {
      const token = generateToken({ id: user.id, email: user.email, type: 'client' });
      const { password_hash, ...safe } = user;
      return res.json({ message: 'Already enrolled in this course', enrollment: enrollExists.rows[0], token, user: safe });
    }

    // Validate referral code
    let refCode = referred_by_code || user.referred_by_code || null;
    if (refCode) {
      const refCheck = await query('SELECT id FROM users WHERE referral_code=$1', [refCode.toUpperCase()]);
      if (!refCheck.rows.length) refCode = null;
    }

    // Create enrollment
    const enrResult = await query(`INSERT INTO enrollments (user_id,course_id,full_name,email,phone,amount,referred_by_code,status,payment_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','unpaid') RETURNING *`,
      [user.id, course_id, full_name, email.toLowerCase(), phone||'', course.price, refCode||null]);

    const token = generateToken({ id: user.id, email: user.email, type: 'client' });
    const { password_hash, ...safe } = user;
    res.json({ message: 'Enrollment created', enrollment: enrResult.rows[0], token, user: safe });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message||'Enrollment failed' }); }
});

// MY COURSES
router.get('/my-courses', authenticateToken, async (req, res) => {
  try {
    const r = await query(`SELECT e.*,c.title as course_title,c.tagline as course_tagline,
      c.icon as course_icon,c.is_flagship,
      (SELECT COUNT(*) FROM course_modules cm WHERE cm.course_id=c.id)::int as total_modules
      FROM enrollments e JOIN courses c ON e.course_id=c.id
      WHERE e.user_id=$1 ORDER BY e.submitted_at DESC`, [req.user.id]);
    res.json({ enrollments: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get courses' }); }
});

// ENROLLMENT DETAIL + MODULES
router.get('/:id/detail', authenticateToken, async (req, res) => {
  try {
    const enrResult = await query(`SELECT e.*,c.title,c.tagline,c.description FROM enrollments e
      JOIN courses c ON e.course_id=c.id WHERE e.id=$1 AND e.user_id=$2`, [req.params.id, req.user.id]);
    const enr = enrResult.rows[0];
    if (!enr) return res.status(404).json({ error: 'Enrollment not found' });
    const modResult = await query('SELECT * FROM course_modules WHERE course_id=$1 ORDER BY module_number', [enr.course_id]);
    res.json({ enrollment: enr, course: { id: enr.course_id, title: enr.title, tagline: enr.tagline }, modules: modResult.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get detail' }); }
});

// COMPLETE MODULE
router.post('/:id/complete-module', authenticateToken, async (req, res) => {
  try {
    const { module_id } = req.body;
    if (!module_id) return res.status(400).json({ error: 'module_id required' });
    const enrResult = await query('SELECT * FROM enrollments WHERE id=$1 AND user_id=$2 AND status=$3', [req.params.id, req.user.id, 'approved']);
    const enr = enrResult.rows[0];
    if (!enr) return res.status(404).json({ error: 'Enrollment not found or not approved' });
    const completed = enr.completed_modules || [];
    if (!completed.includes(parseInt(module_id))) {
      const newCompleted = [...completed, parseInt(module_id)];
      await query('UPDATE enrollments SET completed_modules=$1 WHERE id=$2', [newCompleted, enr.id]);
      // Update module streak
      const today = new Date().toISOString().split('T')[0];
      const userResult = await query('SELECT module_streak,module_last_date FROM users WHERE id=$1', [req.user.id]);
      const u = userResult.rows[0];
      const lastDate = u.module_last_date ? new Date(u.module_last_date).toISOString().split('T')[0] : null;
      let newStreak = u.module_streak || 0;
      if (lastDate === today) { /* same day */ }
      else if (lastDate && new Date(today)-new Date(lastDate) <= 86400000) { newStreak += 1; }
      else { newStreak = 1; }
      await query('UPDATE users SET module_streak=$1, module_last_date=$2 WHERE id=$3', [newStreak, today, req.user.id]);
      return res.json({ message: 'Module completed', completed_modules: newCompleted, module_streak: newStreak });
    }
    res.json({ message: 'Already completed', completed_modules: completed });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to complete module' }); }
});

// SUBMIT PAYMENT PROOF (manual fallback)
router.post('/payment-proof', async (req, res) => {
  try {
    const { email, enrollment_id, proof_url } = req.body;
    if (!email||!enrollment_id||!proof_url) return res.status(400).json({ error: 'email, enrollment_id and proof_url required' });
    await query('UPDATE enrollments SET payment_proof=$1, payment_status=$2 WHERE id=$3 AND email=$4',
      [proof_url, 'pending', enrollment_id, email.toLowerCase()]);
    res.json({ message: 'Payment proof submitted' });
  } catch(err) { res.status(500).json({ error: 'Failed to submit proof' }); }
});

module.exports = router;
