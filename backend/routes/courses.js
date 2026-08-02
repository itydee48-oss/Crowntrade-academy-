const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAdmin, requireMentor } = require('../middleware/auth');

// PUBLIC: GET ALL COURSES
router.get('/', async (req, res) => {
  try {
    const r = await query('SELECT * FROM courses WHERE is_published=TRUE ORDER BY is_flagship DESC, created_at ASC');
    res.json({ courses: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get courses' }); }
});

// PUBLIC: GET COURSE BY SLUG
router.get('/:slug', async (req, res) => {
  try {
    const r = await query('SELECT * FROM courses WHERE slug=$1 AND is_published=TRUE', [req.params.slug]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Course not found' });
    res.json({ course: r.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to get course' }); }
});

// ADMIN: ALL COURSES
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT c.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=c.id AND e.status='approved')::int as enrolled_count,
      (SELECT COUNT(*) FROM course_modules cm WHERE cm.course_id=c.id)::int as module_count
      FROM courses c ORDER BY c.created_at DESC`);
    res.json({ courses: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get courses' }); }
});

// ADMIN: CREATE COURSE
router.post('/admin/create', requireAdmin, async (req, res) => {
  try {
    const { title, slug, tagline, description, price, referral_commission, is_flagship } = req.body;
    if (!title||!slug||!price) return res.status(400).json({ error: 'Title, slug and price required' });
    const r = await query(`INSERT INTO courses (title,slug,tagline,description,price,referral_commission,is_flagship,is_published)
      VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *`,
      [title, slug, tagline||'', description||'', price, referral_commission||200, is_flagship||false]);
    res.json({ course: r.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to create course' }); }
});

// ADMIN: UPDATE COURSE
router.patch('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const { title, tagline, description, price, referral_commission, is_published, is_flagship, assigned_mentor_id } = req.body;
    await query(`UPDATE courses SET title=COALESCE($1,title), tagline=COALESCE($2,tagline),
      description=COALESCE($3,description), price=COALESCE($4,price),
      referral_commission=COALESCE($5,referral_commission), is_published=COALESCE($6,is_published),
      is_flagship=COALESCE($7,is_flagship), assigned_mentor_id=COALESCE($8,assigned_mentor_id) WHERE id=$9`,
      [title||null, tagline||null, description||null, price||null, referral_commission||null,
       is_published!=null?is_published:null, is_flagship!=null?is_flagship:null, assigned_mentor_id||null, req.params.id]);
    res.json({ message: 'Course updated' });
  } catch(err) { res.status(500).json({ error: 'Failed to update course' }); }
});

module.exports = router;
