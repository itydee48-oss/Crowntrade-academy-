const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { requireMentor, generateToken } = require('../middleware/auth');

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: 'Email and password required' });
    const result = await query('SELECT * FROM mentors WHERE email=$1', [email]);
    const mentor = result.rows[0];
    if (!mentor) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, mentor.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const token = generateToken({ id: mentor.id, email: mentor.email, type: 'mentor' });
    const { password_hash, ...safe } = mentor;
    res.json({ message: 'Login successful', token, mentor: safe });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Login failed' }); }
});

// GET PROFILE
router.get('/profile', requireMentor, async (req, res) => {
  try {
    const result = await query('SELECT id,full_name,display_name,email,phone,bio,avatar_url,status,created_at FROM mentors WHERE id=$1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Mentor not found' });
    res.json({ mentor: result.rows[0] });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get profile' }); }
});

// UPDATE PROFILE
router.patch('/profile', requireMentor, async (req, res) => {
  try {
    const { display_name, full_name, phone, bio, avatar_url } = req.body;
    await query(`UPDATE mentors SET display_name=COALESCE($1,display_name), full_name=COALESCE($2,full_name),
      phone=COALESCE($3,phone), bio=COALESCE($4,bio), avatar_url=COALESCE($5,avatar_url) WHERE id=$6`,
      [display_name||null, full_name||null, phone||null, bio||null, avatar_url||null, req.user.id]);
    res.json({ message: 'Profile updated' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to update profile' }); }
});

// CHANGE PASSWORD
router.post('/change-password', requireMentor, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password||!new_password) return res.status(400).json({ error: 'Both passwords required' });
    const result = await query('SELECT password_hash FROM mentors WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE mentors SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password updated' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to change password' }); }
});

// GET ASSIGNED COURSES
router.get('/courses', requireMentor, async (req, res) => {
  try {
    const result = await query('SELECT * FROM courses WHERE assigned_mentor_id=$1 AND is_published=TRUE', [req.user.id]);
    res.json({ courses: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get courses' }); }
});

// GET COURSE MODULES
router.get('/courses/:courseId/modules', requireMentor, async (req, res) => {
  try {
    const result = await query('SELECT * FROM course_modules WHERE course_id=$1 ORDER BY module_number', [req.params.courseId]);
    const modules = result.rows.map(m => ({
      ...m,
      quiz: JSON.parse(m.quiz_json || '[]'),
      materials: JSON.parse(m.materials_json || '[]')
    }));
    res.json({ modules });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get modules' }); }
});

// ADD MODULE
router.post('/courses/:courseId/modules', requireMentor, async (req, res) => {
  try {
    const { module_number, title, description, video_provider, video_id, duration_label, quiz_required, quiz_pass_threshold } = req.body;
    if (!title||!module_number) return res.status(400).json({ error: 'Title and module number required' });
    const result = await query(`INSERT INTO course_modules (course_id,module_number,title,description,video_provider,video_id,duration_label,quiz_required,quiz_pass_threshold)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.courseId, module_number, title, description||'', video_provider||'vimeo', video_id||'', duration_label||'', quiz_required||false, quiz_pass_threshold||70]);
    res.json({ module: result.rows[0] });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to add module' }); }
});

// UPDATE MODULE
router.patch('/modules/:id', requireMentor, async (req, res) => {
  try {
    const { title, description, video_provider, video_id, duration_label, quiz_required, quiz_pass_threshold, module_number } = req.body;
    await query(`UPDATE course_modules SET title=COALESCE($1,title), description=COALESCE($2,description),
      video_provider=COALESCE($3,video_provider), video_id=COALESCE($4,video_id),
      duration_label=COALESCE($5,duration_label), quiz_required=COALESCE($6,quiz_required),
      quiz_pass_threshold=COALESCE($7,quiz_pass_threshold), module_number=COALESCE($8,module_number) WHERE id=$9`,
      [title||null, description||null, video_provider||null, video_id||null, duration_label||null,
       quiz_required!=null?quiz_required:null, quiz_pass_threshold||null, module_number||null, req.params.id]);
    res.json({ message: 'Module updated' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to update module' }); }
});

// SAVE QUIZ
router.put('/modules/:id/quiz', requireMentor, async (req, res) => {
  try {
    const { questions } = req.body;
    await query('UPDATE course_modules SET quiz_json=$1, quiz_required=TRUE WHERE id=$2', [JSON.stringify(questions||[]), req.params.id]);
    res.json({ message: 'Quiz saved' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to save quiz' }); }
});

// SAVE MATERIALS
router.put('/modules/:id/materials', requireMentor, async (req, res) => {
  try {
    const { materials } = req.body;
    await query('UPDATE course_modules SET materials_json=$1 WHERE id=$2', [JSON.stringify(materials||[]), req.params.id]);
    res.json({ message: 'Materials saved' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to save materials' }); }
});

// DELETE MODULE
router.delete('/modules/:id', requireMentor, async (req, res) => {
  try {
    await query('DELETE FROM course_modules WHERE id=$1', [req.params.id]);
    res.json({ message: 'Module deleted' });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to delete module' }); }
});

// GET CLIENT QUIZ SCORES
router.get('/clients/:clientId/quiz-scores', requireMentor, async (req, res) => {
  try {
    const result = await query(`SELECT qa.*, cm.title as module_title FROM quiz_attempts qa
      JOIN course_modules cm ON qa.module_id = cm.id
      WHERE qa.user_id=$1 ORDER BY qa.attempted_at DESC`, [req.params.clientId]);
    res.json({ attempts: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get scores' }); }
});

module.exports = router;
