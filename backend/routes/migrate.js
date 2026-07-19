const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

// One-time migration endpoint — adds missing columns and tables to existing DB
// Run once, then this file can be deleted
router.post('/run', requireAdmin, async (req, res) => {
  const results = [];

  async function safe(label, sql) {
    try {
      await query(sql);
      results.push(`✅ ${label}`);
    } catch(err) {
      results.push(`⚠️  ${label}: ${err.message}`);
    }
  }

  // ── NEW COLUMNS ON users ─────────────────────────────────────────────────
  await safe('users.mentor_id', `ALTER TABLE users ADD COLUMN IF NOT EXISTS mentor_id INTEGER REFERENCES mentors(id)`);
  await safe('users.login_streak', `ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER DEFAULT 0`);
  await safe('users.login_last_date', `ALTER TABLE users ADD COLUMN IF NOT EXISTS login_last_date DATE`);
  await safe('users.module_streak', `ALTER TABLE users ADD COLUMN IF NOT EXISTS module_streak INTEGER DEFAULT 0`);
  await safe('users.module_last_date', `ALTER TABLE users ADD COLUMN IF NOT EXISTS module_last_date DATE`);

  // ── NEW COLUMNS ON mentors ───────────────────────────────────────────────
  await safe('mentors table exists check', `CREATE TABLE IF NOT EXISTS mentors (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    display_name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    bio TEXT,
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await safe('mentors.display_name', `ALTER TABLE mentors ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await safe('mentors.bio', `ALTER TABLE mentors ADD COLUMN IF NOT EXISTS bio TEXT`);
  await safe('mentors.avatar_url', `ALTER TABLE mentors ADD COLUMN IF NOT EXISTS avatar_url TEXT`);

  // ── NEW COLUMNS ON courses ───────────────────────────────────────────────
  await safe('courses.assigned_mentor_id', `ALTER TABLE courses ADD COLUMN IF NOT EXISTS assigned_mentor_id INTEGER REFERENCES mentors(id)`);

  // ── NEW COLUMNS ON course_modules ────────────────────────────────────────
  await safe('course_modules.quiz_required', `ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS quiz_required BOOLEAN DEFAULT FALSE`);
  await safe('course_modules.quiz_pass_threshold', `ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS quiz_pass_threshold INTEGER DEFAULT 70`);
  await safe('course_modules.materials_json', `ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS materials_json TEXT DEFAULT '[]'`);

  // ── NEW TABLES ────────────────────────────────────────────────────────────
  await safe('mentor_availability table', `CREATE TABLE IF NOT EXISTS mentor_availability (
    id SERIAL PRIMARY KEY,
    mentor_id INTEGER NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await safe('sessions table', `CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    mentor_id INTEGER NOT NULL REFERENCES mentors(id),
    client_user_id INTEGER NOT NULL REFERENCES users(id),
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    status TEXT DEFAULT 'pending',
    contact_method TEXT DEFAULT 'whatsapp',
    contact_link TEXT,
    client_notes TEXT,
    mentor_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await safe('mentor_reassignment_requests table', `CREATE TABLE IF NOT EXISTS mentor_reassignment_requests (
    id SERIAL PRIMARY KEY,
    mentor_id INTEGER NOT NULL REFERENCES mentors(id),
    client_user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_notes TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP
  )`);

  await safe('quiz_attempts table', `CREATE TABLE IF NOT EXISTS quiz_attempts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    module_id INTEGER NOT NULL REFERENCES course_modules(id),
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
    answers_json TEXT NOT NULL,
    score INTEGER NOT NULL,
    passed BOOLEAN NOT NULL,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await safe('trade_journal table', `CREATE TABLE IF NOT EXISTS trade_journal (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    pair TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('buy','sell')),
    entry_price NUMERIC(12,5) NOT NULL,
    sl_price NUMERIC(12,5) NOT NULL,
    tp_price NUMERIC(12,5) NOT NULL,
    exit_price NUMERIC(12,5),
    outcome TEXT CHECK (outcome IN ('win','loss','breakeven','open')),
    setup_type TEXT,
    screenshot_url TEXT,
    notes TEXT,
    pips_result NUMERIC(8,1),
    rr_result NUMERIC(6,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Re-link existing mentor account ──────────────────────────────────────
  // If mentor was created before mentor_id column existed on users, nothing to fix
  // Just confirm mentor record exists
  const mentorCheck = await query("SELECT id, email FROM mentors LIMIT 5");
  results.push(`ℹ️  Mentors in DB: ${mentorCheck.rows.map(m=>m.email).join(', ') || 'none'}`);

  res.json({ message: 'Migration complete', results });
});

module.exports = router;
