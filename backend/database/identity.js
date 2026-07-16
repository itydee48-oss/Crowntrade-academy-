const bcrypt = require('bcryptjs');
const { query } = require('./db');

async function findOrCreateUser({ full_name, email, phone, password }) {
  const existing = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) return { user: existing.rows[0], isNew: false };

  const passwordHash = bcrypt.hashSync(password, 10);
  const memberNumber = await nextMemberNumber();
  const result = await query(`
    INSERT INTO users (member_number,full_name,email,phone,password_hash,status)
    VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *
  `, [memberNumber, full_name, email, phone, passwordHash]);
  return { user: result.rows[0], isNew: true };
}

async function nextMemberNumber() {
  const result = await query('SELECT MAX(member_number) as max FROM users');
  const max = result.rows[0].max;
  if (!max || max < 1001) return 1001;
  return max + 1;
}

async function grantMentorship(userId) {
  await query(`
    UPDATE users SET has_mentorship=TRUE, has_partner_status=TRUE, status='active', updated_at=CURRENT_TIMESTAMP WHERE id=$1
  `, [userId]);
}

async function grantPartnerStatus(userId, { tier = 'bronze', referralCode } = {}) {
  await query(`
    UPDATE users SET has_partner_status=TRUE, partner_tier=$2, referral_code=COALESCE(referral_code,$3), status='active', updated_at=CURRENT_TIMESTAMP WHERE id=$1
  `, [userId, tier, referralCode || null]);
}

module.exports = { findOrCreateUser, nextMemberNumber, grantMentorship, grantPartnerStatus };
