const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Add it as an environment variable on your Render backend service.');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

async function query(text, params) { return getPool().query(text, params); }

async function initDB() {
  const p = getPool();

  // ── CORE IDENTITY ──────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      member_number INTEGER UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      has_mentorship BOOLEAN NOT NULL DEFAULT FALSE,
      has_partner_status BOOLEAN NOT NULL DEFAULT FALSE,
      partner_tier TEXT,
      referral_code TEXT UNIQUE,
      referred_by_code TEXT,
      mentor_id INTEGER,
      login_streak INTEGER DEFAULT 0,
      login_last_date DATE,
      module_streak INTEGER DEFAULT 0,
      module_last_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── ADMIN ──────────────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── MENTORS ────────────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS mentors (
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
    );
  `);

  // ── MENTOR AVAILABILITY ────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS mentor_availability (
      id SERIAL PRIMARY KEY,
      mentor_id INTEGER NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── SESSIONS ───────────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS sessions (
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
    );
  `);

  // ── MENTOR REASSIGNMENT REQUESTS ───────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS mentor_reassignment_requests (
      id SERIAL PRIMARY KEY,
      mentor_id INTEGER NOT NULL REFERENCES mentors(id),
      client_user_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP
    );
  `);

  // ── COURSES ────────────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      tagline TEXT,
      description TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      thumbnail_url TEXT,
      icon TEXT DEFAULT 'fa-graduation-cap',
      is_flagship BOOLEAN DEFAULT FALSE,
      is_published BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      referral_commission INTEGER DEFAULT 200,
      assigned_mentor_id INTEGER REFERENCES mentors(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── COURSE MODULES ─────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS course_modules (
      id SERIAL PRIMARY KEY,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      module_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      video_provider TEXT DEFAULT 'vimeo',
      video_id TEXT,
      duration_label TEXT,
      quiz_json TEXT DEFAULT '[]',
      quiz_required BOOLEAN DEFAULT FALSE,
      quiz_pass_threshold INTEGER DEFAULT 70,
      materials_json TEXT DEFAULT '[]',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── ENROLLMENTS ────────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      course_id INTEGER NOT NULL REFERENCES courses(id),
      payment_proof TEXT,
      amount INTEGER,
      payment_status TEXT DEFAULT 'unpaid',
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      welcomed BOOLEAN DEFAULT FALSE,
      completed_modules TEXT DEFAULT '[]',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP
    );
  `);

  // ── QUIZ ATTEMPTS ──────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      module_id INTEGER NOT NULL REFERENCES course_modules(id),
      enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
      answers_json TEXT NOT NULL,
      score INTEGER NOT NULL,
      passed BOOLEAN NOT NULL,
      attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── TRADE JOURNAL ──────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS trade_journal (
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
    );
  `);

  // ── REFERRAL TABLES ────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS referral_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_spots INTEGER DEFAULT 50,
      spots_filled INTEGER DEFAULT 0
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS referral_applications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      motivation TEXT,
      payment_proof TEXT,
      amount INTEGER DEFAULT 500,
      payment_status TEXT DEFAULT 'pending',
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      welcomed BOOLEAN DEFAULT FALSE,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS mentorship_applications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      experience_level TEXT NOT NULL,
      trading_goals TEXT NOT NULL,
      preferred_markets TEXT,
      time_commitment TEXT NOT NULL,
      program TEXT DEFAULT 'Elite Mentorship',
      amount INTEGER DEFAULT 3500,
      payment_proof TEXT,
      payment_status TEXT DEFAULT 'unpaid',
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      welcomed BOOLEAN DEFAULT FALSE,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS referral_earnings (
      id SERIAL PRIMARY KEY,
      referrer_user_id INTEGER NOT NULL REFERENCES users(id),
      referred_email TEXT NOT NULL,
      referred_name TEXT,
      amount INTEGER DEFAULT 200,
      commission_type TEXT DEFAULT 'standard',
      status TEXT DEFAULT 'pending',
      available_after TIMESTAMP,
      source_type TEXT DEFAULT 'enrollment',
      source_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id SERIAL PRIMARY KEY,
      referrer_user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL,
      mpesa_number TEXT NOT NULL,
      mpesa_name TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      mpesa_code TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP
    );
  `);

  // ── SEED DATA ──────────────────────────────────────────────────────────────
  const bcrypt = require('bcryptjs');

  const settings = await p.query('SELECT id FROM referral_settings WHERE id=1');
  if (settings.rows.length === 0) await p.query('INSERT INTO referral_settings (id,total_spots,spots_filled) VALUES (1,50,0)');

  const courseCount = await p.query('SELECT COUNT(*)::int as c FROM courses');
  if (courseCount.rows[0].c === 0) {
    await p.query(`INSERT INTO courses (slug,title,tagline,description,price,icon,is_flagship,is_published,sort_order,referral_commission) VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE,0,200)`,
      ['elite-trading-mentorship','Elite Trading Mentorship','Transform Your Trading with 1-on-1 Expert Guidance',
       'Our flagship program — advanced chart analysis, proprietary strategies, risk management, and live trading sessions.',3500,'fa-chart-line']);
    console.log('✅ Seeded flagship course');
  }

  const adminExists = await p.query("SELECT id FROM admin_users WHERE username='admin'");
  if (adminExists.rows.length === 0) {
    const pw = process.env.ADMIN_PASSWORD || 'CrownAdmin2024!';
    await p.query("INSERT INTO admin_users (username,password_hash,email) VALUES ($1,$2,$3)",
      ['admin', bcrypt.hashSync(pw,10), 'crowntradeacademy@gmail.com']);
    console.log('✅ Default admin created. Password:', pw);
  }

  const demoCheck = await p.query("SELECT id FROM users WHERE email='demo@crowntest.com'");
  if (demoCheck.rows.length === 0) {
    const ur = await p.query(`INSERT INTO users (member_number,full_name,email,phone,password_hash,status,has_mentorship,has_partner_status) VALUES (9001,'Demo Client','demo@crowntest.com','+254700000001',$1,'active',TRUE,TRUE) RETURNING id`,
      [bcrypt.hashSync('Demo1234!',10)]);
    const flagship = await p.query("SELECT id FROM courses WHERE is_flagship=TRUE LIMIT 1");
    if (flagship.rows.length > 0) await p.query(`INSERT INTO enrollments (user_id,course_id,amount,payment_status,status,welcomed) VALUES ($1,$2,3500,'verified','approved',TRUE)`, [ur.rows[0].id, flagship.rows[0].id]);
    console.log('✅ Demo client seeded: demo@crowntest.com / Demo1234!');
  }

  const refCheck = await p.query("SELECT id FROM users WHERE email='referral@crowntest.com'");
  if (refCheck.rows.length === 0) {
    const ur = await p.query(`INSERT INTO users (member_number,full_name,email,phone,password_hash,status,has_partner_status,partner_tier,referral_code) VALUES (9002,'Demo Partner','referral@crowntest.com','+254700000002',$1,'active',TRUE,'gold','DEMO9999') RETURNING id`,
      [bcrypt.hashSync('Demo1234!',10)]);
    await p.query(`INSERT INTO referral_applications (user_id,amount,payment_status,status,welcomed) VALUES ($1,500,'verified','approved',TRUE)`, [ur.rows[0].id]);
    await p.query(`INSERT INTO referral_earnings (referrer_user_id,referred_email,amount,status) VALUES ($1,'c1@example.com',200,'paid'),($1,'c2@example.com',200,'paid'),($1,'c3@example.com',250,'pending')`, [ur.rows[0].id]);
    console.log('✅ Demo partner seeded: referral@crowntest.com / Demo1234!');
  }

  console.log('✅ Postgres DB initialized');
  return p;
}

module.exports = { getPool, query, initDB };
