const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

async function initDB() {
  const p = await pool.connect();
  try {
    await p.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      phone TEXT, password_hash TEXT, member_number TEXT UNIQUE, referral_code TEXT UNIQUE,
      referred_by_code TEXT, has_mentorship BOOLEAN DEFAULT FALSE, has_partner_status BOOLEAN DEFAULT FALSE,
      mentor_id INTEGER, partner_tier TEXT DEFAULT 'bronze', status TEXT DEFAULT 'active',
      login_streak INTEGER DEFAULT 0, login_last_date DATE, module_streak INTEGER DEFAULT 0,
      module_last_date DATE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT,
      password_hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS mentors (
      id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, display_name TEXT,
      email TEXT UNIQUE NOT NULL, phone TEXT, password_hash TEXT NOT NULL,
      bio TEXT, avatar_url TEXT, status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      tagline TEXT, description TEXT, price INTEGER NOT NULL DEFAULT 3500,
      referral_commission INTEGER DEFAULT 200, icon TEXT DEFAULT 'fa-graduation-cap',
      is_published BOOLEAN DEFAULT TRUE, is_flagship BOOLEAN DEFAULT FALSE,
      assigned_mentor_id INTEGER REFERENCES mentors(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS course_modules (
      id SERIAL PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      module_number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT,
      video_provider TEXT DEFAULT 'vimeo', video_id TEXT, duration_label TEXT,
      quiz_required BOOLEAN DEFAULT FALSE, quiz_pass_threshold INTEGER DEFAULT 70,
      quiz_json TEXT DEFAULT '[]', materials_json TEXT DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      course_id INTEGER NOT NULL REFERENCES courses(id), full_name TEXT NOT NULL,
      email TEXT NOT NULL, phone TEXT, amount INTEGER, referred_by_code TEXT,
      payment_proof TEXT, payment_status TEXT DEFAULT 'unpaid', status TEXT DEFAULT 'pending',
      completed_modules INTEGER[] DEFAULT '{}',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMP,
      UNIQUE(user_id, course_id))`);

    await p.query(`CREATE TABLE IF NOT EXISTS mentorship_applications (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
      experience_level TEXT, preferred_markets TEXT, time_commitment TEXT,
      trading_goals TEXT, referral_code TEXT, payment_proof TEXT,
      payment_status TEXT DEFAULT 'unpaid', amount INTEGER DEFAULT 3500,
      status TEXT DEFAULT 'pending', admin_notes TEXT, welcomed BOOLEAN DEFAULT FALSE,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS referral_applications (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, motivation TEXT,
      payment_proof TEXT, payment_status TEXT DEFAULT 'unpaid', amount INTEGER DEFAULT 500,
      partner_tier TEXT DEFAULT 'bronze', status TEXT DEFAULT 'pending',
      admin_notes TEXT, welcomed BOOLEAN DEFAULT FALSE,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS referral_earnings (
      id SERIAL PRIMARY KEY, agent_user_id INTEGER NOT NULL REFERENCES users(id),
      referred_user_id INTEGER REFERENCES users(id), referred_name TEXT,
      referred_email TEXT, source_type TEXT, source_id INTEGER, amount INTEGER NOT NULL,
      commission_type TEXT DEFAULT 'standard', status TEXT DEFAULT 'pending',
      available_after TIMESTAMP, paid_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL, mpesa_number TEXT NOT NULL, mpesa_name TEXT,
      mpesa_code TEXT, status TEXT DEFAULT 'pending', admin_notes TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, processed_at TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS referral_settings (
      id INTEGER PRIMARY KEY DEFAULT 1, total_spots INTEGER DEFAULT 100,
      spots_filled INTEGER DEFAULT 0, first_referral_bonus INTEGER DEFAULT 300,
      standard_commission INTEGER DEFAULT 200, silver_commission INTEGER DEFAULT 250,
      crown_commission INTEGER DEFAULT 300, silver_threshold INTEGER DEFAULT 5,
      crown_threshold INTEGER DEFAULT 10)`);
    await p.query(`INSERT INTO referral_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

    await p.query(`CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY, mentor_id INTEGER NOT NULL REFERENCES mentors(id),
      client_user_id INTEGER NOT NULL REFERENCES users(id),
      scheduled_at TIMESTAMP NOT NULL, duration_minutes INTEGER DEFAULT 60,
      status TEXT DEFAULT 'pending', contact_method TEXT DEFAULT 'whatsapp',
      contact_link TEXT, client_notes TEXT, mentor_notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS mentor_availability (
      id SERIAL PRIMARY KEY, mentor_id INTEGER NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TIME NOT NULL, end_time TIME NOT NULL, is_active BOOLEAN DEFAULT TRUE)`);

    await p.query(`CREATE TABLE IF NOT EXISTS mentor_reassignment_requests (
      id SERIAL PRIMARY KEY, mentor_id INTEGER NOT NULL REFERENCES mentors(id),
      client_user_id INTEGER NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending', admin_notes TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS quiz_attempts (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      module_id INTEGER NOT NULL REFERENCES course_modules(id),
      enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
      answers_json TEXT NOT NULL, score INTEGER NOT NULL, passed BOOLEAN NOT NULL,
      attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS trade_journal (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      pair TEXT NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('buy','sell')),
      entry_price NUMERIC(12,5) NOT NULL, sl_price NUMERIC(12,5) NOT NULL,
      tp_price NUMERIC(12,5) NOT NULL, exit_price NUMERIC(12,5),
      outcome TEXT CHECK (outcome IN ('win','loss','breakeven','open')),
      setup_type TEXT, notes TEXT, pips_result NUMERIC(8,1), rr_result NUMERIC(6,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    await p.query(`CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      order_id TEXT UNIQUE NOT NULL, order_tracking_id TEXT, tracking_id TEXT,
      amount NUMERIC(12,2) NOT NULL, description TEXT, callback_ref TEXT NOT NULL,
      payment_method TEXT, status TEXT DEFAULT 'pending', paid_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    // Seed admin
    const bcrypt = require('bcryptjs');
    const adminEx = await p.query('SELECT id FROM admin_users WHERE username=$1',['admin']);
    if (!adminEx.rows.length) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD||'CrownAdmin2024!',10);
      await p.query('INSERT INTO admin_users (username,email,password_hash) VALUES ($1,$2,$3)',
        ['admin','crowntradeacademy@gmail.com',hash]);
      console.log('✅ Admin seeded');
    }

    // Seed flagship course
    const courseEx = await p.query('SELECT id FROM courses WHERE slug=$1',['elite-trading-mentorship']);
    if (!courseEx.rows.length) {
      await p.query(`INSERT INTO courses (title,slug,tagline,price,referral_commission,is_flagship,is_published)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        ['Elite Trading Mentorship','elite-trading-mentorship',
         'Master forex and commodities with expert 1-on-1 guidance',3500,200,true,true]);
      console.log('✅ Course seeded');
    }

    // Seed demo client
    const demoEx = await p.query('SELECT id FROM users WHERE email=$1',['demo@crowntest.com']);
    if (!demoEx.rows.length) {
      const hash = await bcrypt.hash('Demo1234!',10);
      await p.query(`INSERT INTO users (full_name,email,phone,password_hash,member_number,status)
        VALUES ($1,$2,$3,$4,$5,$6)`,['Demo Client','demo@crowntest.com','+254700000001',hash,'CTA-0001','active']);
      console.log('✅ Demo client seeded');
    }

    console.log('✅ Database ready');
  } catch(err) { console.error('DB init error:', err.message); }
  finally { p.release(); }
}

module.exports = { query, initDB };
