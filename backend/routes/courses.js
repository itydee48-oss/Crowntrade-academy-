const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT id,slug,title,tagline,description,price,thumbnail_url,icon,is_flagship FROM courses WHERE is_published=TRUE ORDER BY is_flagship DESC,sort_order ASC,id ASC');
    res.json({ courses: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to load courses' }); }
});

router.get('/:slug', async (req, res) => {
  try {
    const courseResult = await query('SELECT * FROM courses WHERE slug=$1 AND is_published=TRUE', [req.params.slug]);
    const course = courseResult.rows[0];
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const modulesResult = await query('SELECT id,module_number,title,description,duration_label,sort_order FROM course_modules WHERE course_id=$1 ORDER BY sort_order ASC,module_number ASC', [course.id]);
    res.json({ course, modules: modulesResult.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to load course' }); }
});

router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM courses ORDER BY is_flagship DESC,sort_order ASC,id ASC');
    res.json({ courses: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to load courses' }); }
});

router.post('/admin/create', requireAdmin, async (req, res) => {
  try {
    const { slug, title, tagline, description, price, thumbnail_url, icon, referral_commission } = req.body;
    if (!slug||!title||price===undefined) return res.status(400).json({ error: 'Slug, title and price are required' });
    const exists = await query('SELECT id FROM courses WHERE slug=$1', [slug]);
    if (exists.rows.length > 0) return res.status(409).json({ error: 'A course with this slug already exists' });
    const result = await query(`INSERT INTO courses (slug,title,tagline,description,price,thumbnail_url,icon,referral_commission) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [slug,title,tagline||'',description||'',price,thumbnail_url||null,icon||'fa-graduation-cap',referral_commission||200]);
    res.status(201).json({ message:'Course created', id:result.rows[0].id });
  } catch (err) { console.error('Create course error:', err); res.status(500).json({ error: 'Failed to create course' }); }
});

router.patch('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const { title,tagline,description,price,thumbnail_url,icon,is_published,sort_order,referral_commission } = req.body;
    await query(`UPDATE courses SET title=COALESCE($1,title),tagline=COALESCE($2,tagline),description=COALESCE($3,description),price=COALESCE($4,price),thumbnail_url=COALESCE($5,thumbnail_url),icon=COALESCE($6,icon),is_published=COALESCE($7,is_published),sort_order=COALESCE($8,sort_order),referral_commission=COALESCE($9,referral_commission),updated_at=CURRENT_TIMESTAMP WHERE id=$10`,
      [title,tagline,description,price,thumbnail_url,icon,is_published,sort_order,referral_commission,req.params.id]);
    res.json({ message:'Course updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update course' }); }
});

router.delete('/admin/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM courses WHERE id=$1', [req.params.id]);
    res.json({ message:'Course deleted' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete course' }); }
});

router.get('/admin/:id/modules', requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM course_modules WHERE course_id=$1 ORDER BY sort_order ASC,module_number ASC', [req.params.id]);
    res.json({ modules: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to load modules' }); }
});

router.post('/admin/:id/modules', requireAdmin, async (req, res) => {
  try {
    const { module_number,title,description,video_provider,video_id,duration_label,quiz_json } = req.body;
    if (!title||module_number===undefined) return res.status(400).json({ error: 'Module number and title are required' });
    const result = await query(`INSERT INTO course_modules (course_id,module_number,title,description,video_provider,video_id,duration_label,quiz_json,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.params.id,module_number,title,description||'',video_provider||'vimeo',video_id||'',duration_label||'',quiz_json||'[]',module_number]);
    res.status(201).json({ message:'Module added', id:result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to add module' }); }
});

router.patch('/admin/modules/:moduleId', requireAdmin, async (req, res) => {
  try {
    const { title,description,video_provider,video_id,duration_label,quiz_json,sort_order } = req.body;
    await query(`UPDATE course_modules SET title=COALESCE($1,title),description=COALESCE($2,description),video_provider=COALESCE($3,video_provider),video_id=COALESCE($4,video_id),duration_label=COALESCE($5,duration_label),quiz_json=COALESCE($6,quiz_json),sort_order=COALESCE($7,sort_order) WHERE id=$8`,
      [title,description,video_provider,video_id,duration_label,quiz_json,sort_order,req.params.moduleId]);
    res.json({ message:'Module updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update module' }); }
});

router.delete('/admin/modules/:moduleId', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM course_modules WHERE id=$1', [req.params.moduleId]);
    res.json({ message:'Module deleted' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete module' }); }
});

module.exports = router;
