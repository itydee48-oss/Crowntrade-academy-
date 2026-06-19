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
          user_id INTEGER,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
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
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (referrer_id) REFERENCES referral_applications(id)
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

      console.log('✅ Database initialized');
      resolve(database);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { getDB, initDB };
