const express = require('express');
const router = express.Router();
const { getDB } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

// ─── FULL LEDGER OVERVIEW ─────────────────────────────────────────────────────
router.get('/overview', (req, res) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();

    // ── REVENUE ──────────────────────────────────────────────────────────────
    // Course enrollment fees (only approved + payment verified)
    const enrollmentRevenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM enrollments
      WHERE payment_status = 'verified' AND status = 'approved'
    `).get();

    // Referral agent entry fees (approved agents only)
    const agentEntryRevenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM referral_applications
      WHERE payment_status = 'verified' AND status = 'approved'
    `).get();

    const totalRevenue = enrollmentRevenue.total + agentEntryRevenue.total;

    // ── COMMISSIONS / LIABILITIES ─────────────────────────────────────────────
    const commissionsPaid = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM withdrawal_requests WHERE status = 'paid'
    `).get().total;

    const commissionsAvailable = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM referral_earnings
      WHERE status = 'available'
      OR (status = 'pending' AND available_after IS NOT NULL AND available_after <= ?)
    `).get(now).total;

    const commissionsPending = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM referral_earnings
      WHERE status = 'pending'
      AND (available_after IS NULL OR available_after > ?)
    `).get(now).total;

    const totalCommissionsOwed = commissionsAvailable + commissionsPending;

    // ── PROFIT ────────────────────────────────────────────────────────────────
    const grossProfit = totalRevenue - commissionsPaid;
    const projectedProfit = totalRevenue - totalCommissionsOwed - commissionsPaid;
    const commissionRatio = totalRevenue > 0 ? ((totalCommissionsOwed + commissionsPaid) / totalRevenue * 100).toFixed(1) : 0;

    // ── COUNTS ────────────────────────────────────────────────────────────────
    const totalClients = db.prepare("SELECT COUNT(*) as c FROM enrollments WHERE status = 'approved'").get().c;
    const totalPartners = db.prepare("SELECT COUNT(*) as c FROM referral_applications WHERE status = 'approved'").get().c;
    const pendingWithdrawals = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM withdrawal_requests WHERE status = 'pending'").get().t;

    // ── COURSE BREAKDOWN ──────────────────────────────────────────────────────
    const courseBreakdown = db.prepare(`
      SELECT c.title, c.price,
        COUNT(CASE WHEN e.status='approved' AND e.payment_status='verified' THEN 1 END) as enrollments,
        COALESCE(SUM(CASE WHEN e.status='approved' AND e.payment_status='verified' THEN e.amount END), 0) as revenue
      FROM courses c
      LEFT JOIN enrollments e ON e.course_id = c.id
      WHERE c.is_published = 1
      GROUP BY c.id ORDER BY revenue DESC
    `).all();

    res.json({
      revenue: {
        enrollment_fees: enrollmentRevenue.total,
        enrollment_count: enrollmentRevenue.count,
        agent_entry_fees: agentEntryRevenue.total,
        agent_count: agentEntryRevenue.count,
        total: totalRevenue
      },
      commissions: {
        paid: commissionsPaid,
        available: commissionsAvailable,
        pending: commissionsPending,
        total_owed: totalCommissionsOwed,
        pending_withdrawals: pendingWithdrawals
      },
      profit: {
        gross: grossProfit,
        projected: projectedProfit,
        commission_ratio: commissionRatio
      },
      counts: {
        total_clients: totalClients,
        total_partners: totalPartners
      },
      course_breakdown: courseBreakdown
    });
  } catch (err) {
    console.error('Ledger overview error:', err);
    res.status(500).json({ error: 'Failed to load ledger overview' });
  }
});

// ─── MONTHLY CHART DATA ───────────────────────────────────────────────────────
router.get('/monthly', (req, res) => {
  try {
    const db = getDB();
    const months = parseInt(req.query.months) || 6;

    const monthlyEnrollments = db.prepare(`
      SELECT
        strftime('%Y-%m', submitted_at) as month,
        COUNT(*) as enrollments,
        COALESCE(SUM(CASE WHEN payment_status='verified' AND status='approved' THEN amount ELSE 0 END), 0) as revenue
      FROM enrollments
      WHERE submitted_at >= date('now', '-' || ? || ' months')
      GROUP BY month ORDER BY month ASC
    `).all(months);

    const monthlyCommissions = db.prepare(`
      SELECT
        strftime('%Y-%m', processed_at) as month,
        COALESCE(SUM(amount), 0) as paid
      FROM withdrawal_requests
      WHERE status = 'paid'
      AND processed_at >= date('now', '-' || ? || ' months')
      GROUP BY month ORDER BY month ASC
    `).all(months);

    const monthlyAgents = db.prepare(`
      SELECT
        strftime('%Y-%m', submitted_at) as month,
        COUNT(*) as agents,
        COALESCE(SUM(CASE WHEN payment_status='verified' AND status='approved' THEN amount ELSE 0 END), 0) as entry_fees
      FROM referral_applications
      WHERE submitted_at >= date('now', '-' || ? || ' months')
      GROUP BY month ORDER BY month ASC
    `).all(months);

    // Build a full month range so gaps show as 0
    const monthRange = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      monthRange.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const enrollMap = Object.fromEntries(monthlyEnrollments.map(r => [r.month, r]));
    const commMap = Object.fromEntries(monthlyCommissions.map(r => [r.month, r]));
    const agentMap = Object.fromEntries(monthlyAgents.map(r => [r.month, r]));

    const chartData = monthRange.map(m => {
      const enr = enrollMap[m] || { enrollments: 0, revenue: 0 };
      const com = commMap[m] || { paid: 0 };
      const agt = agentMap[m] || { agents: 0, entry_fees: 0 };
      const totalRev = enr.revenue + agt.entry_fees;
      const profit = totalRev - com.paid;
      return {
        month: m,
        label: new Date(m + '-01').toLocaleString('default', { month: 'short', year: '2-digit' }),
        revenue: totalRev,
        enrollment_revenue: enr.revenue,
        agent_revenue: agt.entry_fees,
        commissions_paid: com.paid,
        profit,
        enrollments: enr.enrollments,
        new_agents: agt.agents
      };
    });

    res.json({ chart_data: chartData, months });
  } catch (err) {
    console.error('Monthly chart error:', err);
    res.status(500).json({ error: 'Failed to load chart data' });
  }
});

// ─── GENERATE TEST DATA ───────────────────────────────────────────────────────
router.post('/seed-test-data', async (req, res) => {
  try {
    const db = getDB();
    const bcrypt = require('bcryptjs');
    const { generateToken } = require('../middleware/auth');

    // Get flagship course
    const course = db.prepare("SELECT * FROM courses WHERE is_published = 1 LIMIT 1").get();
    if (!course) return res.status(400).json({ error: 'No courses found. Create a course first.' });

    // Get or create a test referral agent for commissions
    let testAgent = db.prepare("SELECT * FROM referral_applications WHERE email = 'testagent@crowntest.com'").get();
    if (!testAgent) {
      const hash = bcrypt.hashSync('Demo1234!', 10);
      const r = db.prepare(`
        INSERT INTO referral_applications (member_number, full_name, email, phone, password_hash, referral_code, referral_link, amount, payment_status, status, tier, welcomed)
        VALUES (9003, 'Test Agent', 'testagent@crowntest.com', '+254700000003', ?, 'TEST0001', 'http://localhost/ref/TEST0001', 500, 'verified', 'approved', 'silver', 1)
      `).run(hash);
      testAgent = db.prepare("SELECT * FROM referral_applications WHERE id = ?").get(r.lastInsertRowid);
    }

    const names = ['Alice Wanjiru','Brian Ochieng','Carol Njeri','David Kamau','Eve Akinyi','Frank Mwangi','Grace Otieno','Henry Kariuki'];
    const now = new Date();
    let enrollCreated = 0;
    let commCreated = 0;

    // Create 2 enrollments per month for last 6 months
    for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
      for (let j = 0; j < 2; j++) {
        const nameIdx = (monthsAgo * 2 + j) % names.length;
        const name = names[nameIdx];
        const email = `testclient${monthsAgo}${j}@crowntest.com`;
        const existing = db.prepare("SELECT id FROM enrollments WHERE email = ?").get(email);
        if (existing) continue;

        const hash = bcrypt.hashSync('Demo1234!', 10);
        const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 10 + j);
        const dateStr = d.toISOString();

        const enr = db.prepare(`
          INSERT INTO enrollments (full_name, email, phone, password_hash, course_id, member_number, referred_by_code, amount, payment_status, status, welcomed, submitted_at, reviewed_at)
          VALUES (?, ?, '+25470000099${monthsAgo}${j}', ?, ?, ?, 'TEST0001', ?, 'verified', 'approved', 1, ?, ?)
        `).run(name, email, hash, course.id, 9000 + monthsAgo * 2 + j, course.price, dateStr, dateStr);
        enrollCreated++;

        // Commission for the test agent
        const priorCount = db.prepare("SELECT COUNT(*) as c FROM referral_earnings WHERE referrer_id = ?").get(testAgent.id).c;
        const isFirst = priorCount === 0;
        const amount = isFirst ? 300 : (priorCount < 5 ? 200 : 250);
        const availableAfter = new Date(d.getTime() + 48 * 3600000).toISOString();
        db.prepare(`
          INSERT INTO referral_earnings (referrer_id, referred_email, referred_name, amount, commission_type, status, available_after, source_type, source_id, created_at)
          VALUES (?, ?, ?, ?, ?, 'available', ?, 'enrollment', ?, ?)
        `).run(testAgent.id, email, name, amount, isFirst ? 'first_referral' : 'standard', availableAfter, enr.lastInsertRowid, dateStr);
        commCreated++;
      }
    }

    // Add agent entry fee revenue — mark referral agent payment verified
    db.prepare("UPDATE referral_applications SET payment_status = 'verified', amount = 500 WHERE email = 'testagent@crowntest.com'").run();
    db.prepare("UPDATE referral_applications SET payment_status = 'verified', amount = 500 WHERE email = 'referral@crowntest.com'").run();

    // Simulate 2 past paid withdrawals (3 months ago and 1 month ago)
    const existingW = db.prepare("SELECT COUNT(*) as c FROM withdrawal_requests WHERE referrer_id = ?").get(testAgent.id).c;
    if (existingW === 0) {
      const d1 = new Date(now.getFullYear(), now.getMonth() - 3, 15).toISOString();
      const d2 = new Date(now.getFullYear(), now.getMonth() - 1, 20).toISOString();
      db.prepare(`INSERT INTO withdrawal_requests (referrer_id, amount, mpesa_number, mpesa_name, status, mpesa_code, requested_at, processed_at) VALUES (?, 600, '0712000001', 'Test Agent', 'paid', 'QBX123TEST', ?, ?)`).run(testAgent.id, d1, d1);
      db.prepare(`INSERT INTO withdrawal_requests (referrer_id, amount, mpesa_number, mpesa_name, status, mpesa_code, requested_at, processed_at) VALUES (?, 800, '0712000001', 'Test Agent', 'paid', 'RCY456TEST', ?, ?)`).run(testAgent.id, d2, d2);
    }

    res.json({
      message: `Test data generated successfully!`,
      enrollments_created: enrollCreated,
      commissions_created: commCreated,
      test_accounts: {
        client: 'testclient00@crowntest.com / Demo1234!',
        agent: 'testagent@crowntest.com / Demo1234!'
      }
    });
  } catch (err) {
    console.error('Seed test data error:', err);
    res.status(500).json({ error: 'Failed to generate test data: ' + err.message });
  }
});

module.exports = router;
