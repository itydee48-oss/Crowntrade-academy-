const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'crowntraders.db');

let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDB() {
  return new Promise((resolve, reject) => {
    try {
      const database = getDB();

      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'client',
          status TEXT NOT NULL DEFAULT 'pending',
          referral_code TEXT UNIQUE,
          referred_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS mentorship_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_number INTEGER,
          user_id INTEGER,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          password_hash TEXT,
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
          welcomed INTEGER DEFAULT 0,
          submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS referral_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_number INTEGER,
          full_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT NOT NULL,
          password_hash TEXT,
          motivation TEXT,
          referral_code TEXT,
          referred_by_code TEXT,
          payment_proof TEXT,
          amount INTEGER DEFAULT 500,
          payment_status TEXT DEFAULT 'pending',
          status TEXT DEFAULT 'pending',
          tier TEXT DEFAULT 'bronze',
          admin_notes TEXT,
          referral_link TEXT,
          earnings INTEGER DEFAULT 0,
          welcomed INTEGER DEFAULT 0,
          submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS referral_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          total_spots INTEGER DEFAULT 50,
          spots_filled INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS referral_earnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          referrer_id INTEGER NOT NULL,
          referred_email TEXT NOT NULL,
          amount INTEGER DEFAULT 200,
          status TEXT DEFAULT 'pending',
          source_type TEXT DEFAULT 'mentorship',
          source_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (referrer_id) REFERENCES referral_applications(id)
        );

        CREATE TABLE IF NOT EXISTS courses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          tagline TEXT,
          description TEXT,
          price INTEGER NOT NULL DEFAULT 0,
          thumbnail_url TEXT,
          icon TEXT DEFAULT 'fa-graduation-cap',
          is_flagship INTEGER DEFAULT 0,
          is_published INTEGER DEFAULT 1,
          sort_order INTEGER DEFAULT 0,
          referral_commission INTEGER DEFAULT 200,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS course_modules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id INTEGER NOT NULL,
          module_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          video_provider TEXT DEFAULT 'vimeo',
          video_id TEXT,
          duration_label TEXT,
          quiz_json TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS enrollments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          password_hash TEXT,
          course_id INTEGER NOT NULL,
          member_number INTEGER,
          referred_by_code TEXT,
          payment_proof TEXT,
          amount INTEGER,
          payment_status TEXT DEFAULT 'unpaid',
          status TEXT DEFAULT 'pending',
          admin_notes TEXT,
          welcomed INTEGER DEFAULT 0,
          completed_modules TEXT DEFAULT '[]',
          submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          FOREIGN KEY (course_id) REFERENCES courses(id)
        );

        CREATE TABLE IF NOT EXISTS admin_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          email TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          user_type TEXT NOT NULL,
          token TEXT UNIQUE NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Run migrations for existing databases
      try { database.exec(`ALTER TABLE mentorship_applications ADD COLUMN payment_proof TEXT`); } catch {}
      try { database.exec(`ALTER TABLE mentorship_applications ADD COLUMN payment_status TEXT DEFAULT 'unpaid'`); } catch {}
      try { database.exec(`ALTER TABLE mentorship_applications ADD COLUMN password_hash TEXT`); } catch {}
      try { database.exec(`ALTER TABLE mentorship_applications ADD COLUMN member_number INTEGER`); } catch {}
      try { database.exec(`ALTER TABLE mentorship_applications ADD COLUMN welcomed INTEGER DEFAULT 0`); } catch {}
      try { database.exec(`ALTER TABLE referral_applications ADD COLUMN password_hash TEXT`); } catch {}
      try { database.exec(`ALTER TABLE referral_applications ADD COLUMN member_number INTEGER`); } catch {}
      try { database.exec(`ALTER TABLE referral_applications ADD COLUMN motivation TEXT`); } catch {}
      try { database.exec(`ALTER TABLE referral_applications ADD COLUMN tier TEXT DEFAULT 'bronze'`); } catch {}
      try { database.exec(`ALTER TABLE referral_applications ADD COLUMN welcomed INTEGER DEFAULT 0`); } catch {}

      // Seed referral_settings singleton row
      const settingsExists = database.prepare('SELECT id FROM referral_settings WHERE id = 1').get();
      if (!settingsExists) {
        database.prepare('INSERT INTO referral_settings (id, total_spots, spots_filled) VALUES (1, 50, 0)').run();
      }

      // Seed the flagship Elite Trading Mentorship course if no courses exist yet
      const courseCount = database.prepare('SELECT COUNT(*) as c FROM courses').get();
      if (courseCount.c === 0) {
        database.prepare(`
          INSERT INTO courses (slug, title, tagline, description, price, icon, is_flagship, is_published, sort_order, referral_commission)
          VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, 200)
        `).run(
          'elite-trading-mentorship',
          'Elite Trading Mentorship',
          'Transform Your Trading with 1-on-1 Expert Guidance',
          'Our flagship program — advanced chart analysis, proprietary strategies, risk management, and live trading sessions with a personal mentor.',
          3500,
          'fa-chart-line'
        );
        console.log('✅ Seeded flagship course: Elite Trading Mentorship');
      }

      // Seed default admin
      const adminExists = database.prepare("SELECT id FROM admin_users WHERE username = 'admin'").get();
      if (!adminExists) {
        const bcrypt = require('bcryptjs');
        const defaultPassword = process.env.ADMIN_PASSWORD || 'CrownAdmin2024!';
        const hash = bcrypt.hashSync(defaultPassword, 10);
        database.prepare("INSERT INTO admin_users (username, password_hash, email) VALUES (?, ?, ?)")
          .run('admin', hash, 'crowntradeacademy@gmail.com');
        console.log('✅ Default admin created. Password:', defaultPassword);
      }

      // ── DEMO ACCOUNTS (for testing — remove in production) ──────────────────
      const bcrypt = require('bcryptjs');

      // Demo client account — pre-approved on Elite Trading Mentorship
      const demoClient = database.prepare("SELECT id FROM enrollments WHERE email = 'demo@crowntest.com'").get();
      if (!demoClient) {
        const demoHash = bcrypt.hashSync('Demo1234!', 10);
        // Get the flagship course id
        const flagship = database.prepare("SELECT id FROM courses WHERE is_flagship = 1 LIMIT 1").get();
        if (flagship) {
          database.prepare(`
            INSERT INTO enrollments (full_name, email, phone, password_hash, course_id, member_number, amount, payment_status, status, welcomed)
            VALUES ('Demo Client', 'demo@crowntest.com', '+254700000001', ?, ?, 9001, 3500, 'verified', 'approved', 1)
          `).run(demoHash, flagship.id);
          console.log('✅ Demo client account seeded: demo@crowntest.com / Demo1234!');
        }
      }

      // Demo referral agent — pre-approved Crown Partner with sample earnings
      const demoReferral = database.prepare("SELECT id FROM referral_applications WHERE email = 'referral@crowntest.com'").get();
      if (!demoReferral) {
        const refHash = bcrypt.hashSync('Demo1234!', 10);
        const refResult = database.prepare(`
          INSERT INTO referral_applications
            (member_number, full_name, email, phone, password_hash, referral_code, referral_link, amount, payment_status, status, tier, welcomed)
          VALUES (9002, 'Demo Partner', 'referral@crowntest.com', '+254700000002', ?, 'DEMO9999', 'https://itydee48-oss.github.io/crowntraders-academy/referral-register.html?ref=DEMO9999', 500, 'verified', 'approved', 'gold', 1)
        `).run(refHash);
        // Add sample earnings
        if (refResult.lastInsertRowid) {
          const stmt = database.prepare("INSERT INTO referral_earnings (referrer_id, referred_email, amount, status) VALUES (?, ?, ?, ?)");
          stmt.run(refResult.lastInsertRowid, 'client1@example.com', 200, 'paid');
          stmt.run(refResult.lastInsertRowid, 'client2@example.com', 200, 'paid');
          stmt.run(refResult.lastInsertRowid, 'client3@example.com', 250, 'pending');
          database.prepare('UPDATE referral_applications SET earnings = 400, tier = ? WHERE id = ?')
            .run('gold', refResult.lastInsertRowid);
        }
        console.log('✅ Demo referral account seeded: referral@crowntest.com / Demo1234!');
      }
      // ── END DEMO ACCOUNTS ─────────────────────────────────────────────────────

      console.log('✅ Database initialized');
      resolve(database);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { getDB, initDB };
