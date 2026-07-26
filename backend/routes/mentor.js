const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../database/db');
const { generateToken, authenticateToken } = require('../middleware/auth');

function requireMentor(req, res, next) {
  if (!req.user || req.user.type !== 'mentor') return res.status(403).json({ error: 'Mentor access required' });
  next();
}

// ── MENTOR LOGIN ───────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const result = await query('SELECT * FROM mentors WHERE email=$1', [email]);
    const mentor = result.rows[0];
    if (!mentor || !(await bcrypt.compare(password, mentor.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    if (mentor.status !== 'active') return res.status(403).json({ error: 'Account suspended. Contact admin.' });
    const token = generateToken({ id: mentor.id, email: mentor.email, type: 'mentor' }, '30d');
    res.json({ message:'Login successful', token, mentor: safeMentor(mentor) });
  } catch (err) { console.error('Mentor login error:', err); res.status(500).json({ error: 'Login failed' }); }
});

// ── GET MENTOR PROFILE ─────────────────────────────────────────────────────
router.get('/profile', authenticateToken, requireMentor, async (req, res) => {
  try {
    const result = await query('SELECT * FROM mentors WHERE id=$1', [req.user.id]);
    const mentor = result.rows[0];
    if (!mentor) return res.status(404).json({ error: 'Mentor not found' });
    res.json({ mentor: safeMentor(mentor) });
  } catch (err) { res.status(500).json({ error: 'Failed to get profile' }); }
});

// ── UPDATE MENTOR PROFILE ──────────────────────────────────────────────────
router.patch('/profile', authenticateToken, requireMentor, async (req, res) => {
  try {
    const { display_name, bio, phone, avatar_url } = req.body;
    await query(`UPDATE mentors SET display_name=COALESCE($1,display_name),bio=COALESCE($2,bio),phone=COALESCE($3,phone),avatar_url=COALESCE($4,avatar_url) WHERE id=$5`,
      [display_name||null, bio||null, phone||null, avatar_url||null, req.user.id]);
    res.json({ message:'Profile updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update profile' }); }
});

// ── CHANGE PASSWORD ────────────────────────────────────────────────────────
router.post('/change-password', authenticateToken, requireMentor, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const result = await query('SELECT password_hash FROM mentors WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(current_password, result.rows[0].password_hash))) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE mentors SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ message:'Password updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to change password' }); }
});

// ── COURSE CONTENT MANAGEMENT (mentor) ────────────────────────────────────

// Get courses assigned to this mentor
router.get('/courses', authenticateToken, requireMentor, async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*,
        (SELECT COUNT(*)::int FROM course_modules WHERE course_id=c.id) as module_count,
        (SELECT COUNT(*)::int FROM enrollments WHERE course_id=c.id AND status='approved') as enrolled_count
      FROM courses c WHERE c.assigned_mentor_id=$1 ORDER BY c.sort_order ASC
    `, [req.user.id]);
    res.json({ courses: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get courses' }); }
});

// Get modules for a course
router.get('/courses/:courseId/modules', authenticateToken, requireMentor, async (req, res) => {
  try {
    const courseCheck = await query('SELECT id FROM courses WHERE id=$1 AND assigned_mentor_id=$2', [req.params.courseId, req.user.id]);
    if (!courseCheck.rows[0]) return res.status(403).json({ error: 'Course not assigned to you' });
    const result = await query('SELECT * FROM course_modules WHERE course_id=$1 ORDER BY sort_order ASC,module_number ASC', [req.params.courseId]);
    res.json({ modules: result.rows.map(m => ({ ...m, quiz: JSON.parse(m.quiz_json||'[]'), materials: JSON.parse(m.materials_json||'[]') })) });
  } catch (err) { res.status(500).json({ error: 'Failed to get modules' }); }
});

// Add module
router.post('/courses/:courseId/modules', authenticateToken, requireMentor, async (req, res) => {
  try {
    const courseCheck = await query('SELECT id FROM courses WHERE id=$1 AND assigned_mentor_id=$2', [req.params.courseId, req.user.id]);
    if (!courseCheck.rows[0]) return res.status(403).json({ error: 'Course not assigned to you' });

    const { module_number, title, description, video_provider, video_id, duration_label, quiz_required, quiz_pass_threshold } = req.body;
    if (!title || module_number === undefined) return res.status(400).json({ error: 'module_number and title required' });

    const result = await query(`
      INSERT INTO course_modules (course_id,module_number,title,description,video_provider,video_id,duration_label,quiz_required,quiz_pass_threshold,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `, [req.params.courseId, module_number, title, description||'', video_provider||'vimeo', video_id||'', duration_label||'', quiz_required||false, quiz_pass_threshold||70, module_number]);

    res.status(201).json({ message:'Module added', id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to add module' }); }
});

// Update module (title, description, video, quiz_required, threshold)
router.patch('/modules/:moduleId', authenticateToken, requireMentor, async (req, res) => {
  try {
    const modResult = await query(`SELECT cm.* FROM course_modules cm JOIN courses c ON c.id=cm.course_id WHERE cm.id=$1 AND c.assigned_mentor_id=$2`, [req.params.moduleId, req.user.id]);
    if (!modResult.rows[0]) return res.status(403).json({ error: 'Module not found or not your course' });

    const { title, description, video_provider, video_id, duration_label, sort_order, quiz_required, quiz_pass_threshold } = req.body;
    await query(`UPDATE course_modules SET title=COALESCE($1,title),description=COALESCE($2,description),video_provider=COALESCE($3,video_provider),video_id=COALESCE($4,video_id),duration_label=COALESCE($5,duration_label),sort_order=COALESCE($6,sort_order),quiz_required=COALESCE($7,quiz_required),quiz_pass_threshold=COALESCE($8,quiz_pass_threshold) WHERE id=$9`,
      [title,description,video_provider,video_id,duration_label,sort_order,quiz_required,quiz_pass_threshold,req.params.moduleId]);
    res.json({ message:'Module updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update module' }); }
});

// Update quiz for a module
router.put('/modules/:moduleId/quiz', authenticateToken, requireMentor, async (req, res) => {
  try {
    const modResult = await query(`SELECT cm.* FROM course_modules cm JOIN courses c ON c.id=cm.course_id WHERE cm.id=$1 AND c.assigned_mentor_id=$2`, [req.params.moduleId, req.user.id]);
    if (!modResult.rows[0]) return res.status(403).json({ error: 'Module not found or not your course' });

    const { questions, quiz_required, quiz_pass_threshold } = req.body;
    // Validate quiz format
    if (!Array.isArray(questions)) return res.status(400).json({ error: 'questions must be an array' });
    for (const q of questions) {
      if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 || q.correct === undefined)
        return res.status(400).json({ error: 'Each question needs: question, options (array of 4), correct (0-3 index)' });
    }

    await query(`UPDATE course_modules SET quiz_json=$1,quiz_required=COALESCE($2,quiz_required),quiz_pass_threshold=COALESCE($3,quiz_pass_threshold) WHERE id=$4`,
      [JSON.stringify(questions), quiz_required, quiz_pass_threshold||70, req.params.moduleId]);
    res.json({ message:`Quiz saved with ${questions.length} questions` });
  } catch (err) { res.status(500).json({ error: 'Failed to save quiz' }); }
});

// Update materials for a module
router.put('/modules/:moduleId/materials', authenticateToken, requireMentor, async (req, res) => {
  try {
    const modResult = await query(`SELECT cm.* FROM course_modules cm JOIN courses c ON c.id=cm.course_id WHERE cm.id=$1 AND c.assigned_mentor_id=$2`, [req.params.moduleId, req.user.id]);
    if (!modResult.rows[0]) return res.status(403).json({ error: 'Module not found or not your course' });

    const { materials } = req.body; // array of {name, url, type}
    if (!Array.isArray(materials)) return res.status(400).json({ error: 'materials must be an array' });

    await query('UPDATE course_modules SET materials_json=$1 WHERE id=$2', [JSON.stringify(materials), req.params.moduleId]);
    res.json({ message:`${materials.length} materials saved` });
  } catch (err) { res.status(500).json({ error: 'Failed to save materials' }); }
});

// Delete module — BLOCKED if any student has completed it
router.delete('/modules/:moduleId', authenticateToken, requireMentor, async (req, res) => {
  try {
    const modResult = await query(`SELECT cm.* FROM course_modules cm JOIN courses c ON c.id=cm.course_id WHERE cm.id=$1 AND c.assigned_mentor_id=$2`, [req.params.moduleId, req.user.id]);
    if (!modResult.rows[0]) return res.status(403).json({ error: 'Module not found or not your course' });

    // Guard: block delete if any enrolled student has completed this module
    const completionsResult = await query(`SELECT COUNT(*)::int as c FROM enrollments WHERE completed_modules LIKE $1 AND status='approved'`, [`%${req.params.moduleId}%`]);
    if (completionsResult.rows[0].c > 0) {
      return res.status(409).json({ error: `Cannot delete — ${completionsResult.rows[0].c} student(s) have completed this module. Archive it instead by removing the video ID.` });
    }

    await query('DELETE FROM course_modules WHERE id=$1', [req.params.moduleId]);
    res.json({ message:'Module deleted' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete module' }); }
});

// ── CLIENT QUIZ SCORES (for mentor monitoring) ─────────────────────────────
router.get('/clients/:clientId/quiz-scores', authenticateToken, requireMentor, async (req, res) => {
  try {
    const clientCheck = await query('SELECT id FROM users WHERE id=$1 AND mentor_id=$2', [req.params.clientId, req.user.id]);
    if (!clientCheck.rows[0]) return res.status(403).json({ error: 'Client not assigned to you' });

    const result = await query(`
      SELECT qa.*,cm.title as module_title,cm.module_number
      FROM quiz_attempts qa JOIN course_modules cm ON qa.module_id=cm.id
      WHERE qa.user_id=$1 ORDER BY qa.attempted_at DESC
    `, [req.params.clientId]);
    res.json({ attempts: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to get quiz scores' }); }
});

function safeMentor(m) {
  const { password_hash, ...rest } = m;
  return rest;
}

module.exports = router;
