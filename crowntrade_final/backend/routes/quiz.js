const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

router.post('/attempt', authenticateToken, async (req, res) => {
  try {
    const { module_id, enrollment_id, answers } = req.body;
    if (!module_id||!enrollment_id||!answers) return res.status(400).json({ error: 'module_id, enrollment_id, answers required' });
    const modResult = await query('SELECT * FROM course_modules WHERE id=$1', [module_id]);
    const mod = modResult.rows[0];
    if (!mod) return res.status(404).json({ error: 'Module not found' });
    const quiz = JSON.parse(mod.quiz_json || '[]');
    if (!quiz.length) return res.status(400).json({ error: 'No quiz for this module' });
    let correct = 0;
    const results = quiz.map((q, i) => {
      const isCorrect = answers[i] === q.correct;
      if (isCorrect) correct++;
      return { question: q.question, selected: answers[i], correct: q.correct, is_correct: isCorrect, explanation: q.explanation||'' };
    });
    const score = Math.round(correct/quiz.length*100);
    const threshold = mod.quiz_pass_threshold || 70;
    const passed = score >= threshold;
    await query(`INSERT INTO quiz_attempts (user_id,module_id,enrollment_id,answers_json,score,passed)
      VALUES ($1,$2,$3,$4,$5,$6)`, [req.user.id, module_id, enrollment_id, JSON.stringify(answers), score, passed]);
    const msg = passed ? `Excellent! You scored ${score}% — module unlocked!` : `You scored ${score}%. Need ${threshold}% to pass. Try again!`;
    res.json({ score, passed, threshold, message: msg, results });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to submit quiz' }); }
});

router.get('/attempts/:moduleId', authenticateToken, async (req, res) => {
  try {
    const r = await query('SELECT * FROM quiz_attempts WHERE module_id=$1 AND user_id=$2 ORDER BY attempted_at DESC',
      [req.params.moduleId, req.user.id]);
    res.json({ attempts: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get attempts' }); }
});

module.exports = router;
