const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// ── SUBMIT QUIZ ATTEMPT ────────────────────────────────────────────────────
router.post('/attempt', authenticateToken, async (req, res) => {
  try {
    const { module_id, enrollment_id, answers } = req.body;
    if (!module_id || !enrollment_id || !answers) return res.status(400).json({ error: 'module_id, enrollment_id and answers required' });

    // Verify enrollment belongs to this user and is approved
    const enrollResult = await query('SELECT * FROM enrollments WHERE id=$1 AND user_id=$2', [enrollment_id, req.user.id]);
    const enrollment = enrollResult.rows[0];
    if (!enrollment) return res.status(403).json({ error: 'Enrollment not found' });
    if (enrollment.status !== 'approved') return res.status(403).json({ error: 'Course not yet unlocked' });

    // Get module + quiz
    const modResult = await query('SELECT * FROM course_modules WHERE id=$1', [module_id]);
    const module = modResult.rows[0];
    if (!module) return res.status(404).json({ error: 'Module not found' });

    const quiz = JSON.parse(module.quiz_json || '[]');
    if (quiz.length === 0) return res.status(400).json({ error: 'This module has no quiz' });

    // Score the attempt
    let correct = 0;
    const results = quiz.map((q, i) => {
      const isCorrect = answers[i] !== undefined && Number(answers[i]) === Number(q.correct);
      if (isCorrect) correct++;
      return { question: q.question, selected: answers[i], correct: q.correct, is_correct: isCorrect, explanation: q.explanation || null };
    });

    const score = Math.round((correct / quiz.length) * 100);
    const passed = score >= (module.quiz_pass_threshold || 70);

    // Record attempt
    await query(`INSERT INTO quiz_attempts (user_id,module_id,enrollment_id,answers_json,score,passed) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.id, module_id, enrollment_id, JSON.stringify(answers), score, passed]);

    // If passed — mark module complete and update streak
    if (passed) {
      const completed = JSON.parse(enrollment.completed_modules || '[]');
      if (!completed.includes(module_id)) {
        completed.push(module_id);
        await query('UPDATE enrollments SET completed_modules=$1 WHERE id=$2', [JSON.stringify(completed), enrollment_id]);
      }
      // Update module streak
      await updateModuleStreak(req.user.id);
    }

    res.json({
      score, passed, correct, total: quiz.length,
      threshold: module.quiz_pass_threshold || 70,
      results,
      message: passed ? `You scored ${score}%! Module complete.` : `You scored ${score}%. You need ${module.quiz_pass_threshold || 70}% to pass. Try again.`
    });
  } catch (err) {
    console.error('Quiz attempt error:', err);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

// ── GET QUIZ ATTEMPTS FOR A MODULE ────────────────────────────────────────
router.get('/attempts/:moduleId', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT id,score,passed,attempted_at FROM quiz_attempts WHERE user_id=$1 AND module_id=$2 ORDER BY attempted_at DESC',
      [req.user.id, req.params.moduleId]
    );
    res.json({ attempts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get attempts' });
  }
});

// ── HELPER: update module streak ───────────────────────────────────────────
async function updateModuleStreak(userId) {
  const result = await query('SELECT module_streak,module_last_date FROM users WHERE id=$1', [userId]);
  const user = result.rows[0];
  const today = new Date().toISOString().slice(0, 10);
  const last = user.module_last_date ? user.module_last_date.toISOString().slice(0, 10) : null;

  let streak = user.module_streak || 0;
  if (last === today) return; // already counted today
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  streak = last === yesterday ? streak + 1 : 1;
  await query('UPDATE users SET module_streak=$1,module_last_date=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3', [streak, today, userId]);
}

module.exports = router;
