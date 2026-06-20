const express = require('express');
const router = express.Router();
const { getDB } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

// ─── PUBLIC: LIST PUBLISHED COURSES (catalog) ────────────────────────────────
router.get('/', (req, res) => {
  try {
    const db = getDB();
    const courses = db.prepare(
      'SELECT id, slug, title, tagline, description, price, thumbnail_url, icon, is_flagship FROM courses WHERE is_published = 1 ORDER BY is_flagship DESC, sort_order ASC, id ASC'
    ).all();
    res.json({ courses });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// ─── PUBLIC: GET SINGLE COURSE WITH MODULES ──────────────────────────────────
router.get('/:slug', (req, res) => {
  try {
    const db = getDB();
    const course = db.prepare('SELECT * FROM courses WHERE slug = ? AND is_published = 1').get(req.params.slug);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const modules = db.prepare(
      'SELECT id, module_number, title, description, duration_label, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, module_number ASC'
    ).all(course.id);

    res.json({ course, modules });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load course' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES — manage courses & modules
// ═══════════════════════════════════════════════════════════════════════════

router.get('/admin/all', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    const courses = db.prepare('SELECT * FROM courses ORDER BY is_flagship DESC, sort_order ASC, id ASC').all();
    res.json({ courses });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

router.post('/admin/create', requireAdmin, (req, res) => {
  try {
    const { slug, title, tagline, description, price, thumbnail_url, icon, referral_commission } = req.body;
    if (!slug || !title || price === undefined) {
      return res.status(400).json({ error: 'Slug, title and price are required' });
    }
    const db = getDB();
    const exists = db.prepare('SELECT id FROM courses WHERE slug = ?').get(slug);
    if (exists) return res.status(409).json({ error: 'A course with this slug already exists' });

    const result = db.prepare(`
      INSERT INTO courses (slug, title, tagline, description, price, thumbnail_url, icon, referral_commission)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, title, tagline || '', description || '', price, thumbnail_url || null, icon || 'fa-graduation-cap', referral_commission || 200);

    res.status(201).json({ message: 'Course created', id: result.lastInsertRowid });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.patch('/admin/:id', requireAdmin, (req, res) => {
  try {
    const { title, tagline, description, price, thumbnail_url, icon, is_published, sort_order, referral_commission } = req.body;
    const db = getDB();
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    db.prepare(`
      UPDATE courses SET
        title = COALESCE(?, title),
        tagline = COALESCE(?, tagline),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        thumbnail_url = COALESCE(?, thumbnail_url),
        icon = COALESCE(?, icon),
        is_published = COALESCE(?, is_published),
        sort_order = COALESCE(?, sort_order),
        referral_commission = COALESCE(?, referral_commission),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, tagline, description, price, thumbnail_url, icon, is_published, sort_order, referral_commission, req.params.id);

    res.json({ message: 'Course updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.delete('/admin/:id', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
    res.json({ message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// ─── MODULES (admin) ──────────────────────────────────────────────────────────
router.get('/admin/:id/modules', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    const modules = db.prepare('SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, module_number ASC').all(req.params.id);
    res.json({ modules });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load modules' });
  }
});

router.post('/admin/:id/modules', requireAdmin, (req, res) => {
  try {
    const { module_number, title, description, video_provider, video_id, duration_label, quiz_json } = req.body;
    if (!title || module_number === undefined) {
      return res.status(400).json({ error: 'Module number and title are required' });
    }
    const db = getDB();
    const result = db.prepare(`
      INSERT INTO course_modules (course_id, module_number, title, description, video_provider, video_id, duration_label, quiz_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, module_number, title, description || '', video_provider || 'vimeo', video_id || '', duration_label || '', quiz_json || '[]', module_number);

    res.status(201).json({ message: 'Module added', id: result.lastInsertRowid });
  } catch (err) {
    console.error('Add module error:', err);
    res.status(500).json({ error: 'Failed to add module' });
  }
});

router.patch('/admin/modules/:moduleId', requireAdmin, (req, res) => {
  try {
    const { title, description, video_provider, video_id, duration_label, quiz_json, sort_order } = req.body;
    const db = getDB();
    db.prepare(`
      UPDATE course_modules SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        video_provider = COALESCE(?, video_provider),
        video_id = COALESCE(?, video_id),
        duration_label = COALESCE(?, duration_label),
        quiz_json = COALESCE(?, quiz_json),
        sort_order = COALESCE(?, sort_order)
      WHERE id = ?
    `).run(title, description, video_provider, video_id, duration_label, quiz_json, sort_order, req.params.moduleId);

    res.json({ message: 'Module updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update module' });
  }
});

router.delete('/admin/modules/:moduleId', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    db.prepare('DELETE FROM course_modules WHERE id = ?').run(req.params.moduleId);
    res.json({ message: 'Module deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete module' });
  }
});

module.exports = router;
