const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

      // Users table (clients, mentors, admins)
      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'client',  -- client | mentor | admin | referral
          status TEXT NOT NULL DEFAULT 'pending', -- pending | active | suspended
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
          payment_status TEXT DEFAULT 'pending',  -- pending | verified | rejected
          status TEXT DEFAULT 'pending',           -- pending | approved | rejected
          admin_notes TEXT,
          submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS referral_applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          phone TEXT NOT NULL,
          referral_code TEXT,
          referred_by_code TEXT,
          payment_proof TEXT,
          amount INTEGER DEFAULT 500,
          payment_status TEXT DEFAULT 'pending',  -- pending | verified | rejected
          status TEXT DEFAULT 'pending',           -- pending | approved | rejected
          admin_notes TEXT,
          referral_link TEXT,
          earnings INTEGER DEFAULT 0,
          submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS referral_earnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          referrer_id INTEGER NOT NULL,
          referred_email TEXT NOT NULL,
          amount INTEGER DEFAULT 200,
          status TEXT DEFAULT 'pending',  -- pending | paid
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

      // Seed default admin if not exists
      const adminExists = database.prepare(
        "SELECT id FROM admin_users WHERE username = 'admin'"
      ).get();

      if (!adminExists) {
        const bcrypt = require('bcryptjs');
        const defaultPassword = process.env.ADMIN_PASSWORD || 'CrownAdmin2024!';
        const hash = bcrypt.hashSync(defaultPassword, 10);
        database.prepare(
          "INSERT INTO admin_users (username, password_hash, email) VALUES (?, ?, ?)"
        ).run('admin', hash, 'crowntradeacademy@gmail.com');
        console.log('✅ Default admin created. Username: admin, Password:', defaultPassword);
        console.log('⚠️  Change the admin password after first login!');
      }

      console.log('✅ Database initialized successfully');
      resolve(database);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { getDB, initDB };
