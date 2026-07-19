const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { findOrCreateUser, grantPartnerStatus } = require('../database/identity');

router.use(requireAdmin);

router.get('/overview', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const [enrollRev, agentRev, commPaid, commAvail, commPending, totalClients, totalPartners, pendingW, courseBreak] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount),0)::int as total,COUNT(*)::int as count FROM enrollments WHERE payment_status='verified' AND status='approved'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as total,COUNT(*)::int as count FROM referral_applications WHERE payment_status='verified' AND status='approved'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as total FROM withdrawal_requests WHERE status='paid'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as total FROM referral_earnings WHERE status='available' OR (status='pending' AND available_after IS NOT NULL AND available_after<=$1)`, [now]),
      query(`SELECT COALESCE(SUM(amount),0)::int as total FROM referral_earnings WHERE status='pending' AND (available_after IS NULL OR available_after>$1)`, [now]),
      query(`SELECT COUNT(*)::int as c FROM enrollments WHERE status='approved'`),
      query(`SELECT COUNT(*)::int as c FROM referral_applications WHERE status='approved'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as t FROM withdrawal_requests WHERE status='pending'`),
      query(`SELECT c.title,c.price,COUNT(CASE WHEN e.status='approved' AND e.payment_status='verified' THEN 1 END)::int as enrollments,COALESCE(SUM(CASE WHEN e.status='approved' AND e.payment_status='verified' THEN e.amount END),0)::int as revenue FROM courses c LEFT JOIN enrollments e ON e.course_id=c.id WHERE c.is_published=TRUE GROUP BY c.id ORDER BY revenue DESC`)
    ]);

    const totalRevenue = enrollRev.rows[0].total + agentRev.rows[0].total;
    const paid = commPaid.rows[0].total;
    const avail = commAvail.rows[0].total;
    const pend = commPending.rows[0].total;

    res.json({
      revenue: { enrollment_fees:enrollRev.rows[0].total, enrollment_count:enrollRev.rows[0].count, agent_entry_fees:agentRev.rows[0].total, agent_count:agentRev.rows[0].count, total:totalRevenue },
      commissions: { paid, available:avail, pending:pend, total_owed:avail+pend, pending_withdrawals:pendingW.rows[0].t },
      profit: { gross:totalRevenue-paid, projected:totalRevenue-avail-pend-paid, commission_ratio:totalRevenue>0?((avail+pend+paid)/totalRevenue*100).toFixed(1):0 },
      counts: { total_clients:totalClients.rows[0].c, total_partners:totalPartners.rows[0].c },
      course_breakdown: courseBreak.rows
    });
  } catch (err) { console.error('Ledger overview error:', err); res.status(500).json({ error: 'Failed to load ledger overview' }); }
});

router.get('/monthly', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const [monthlyEnr, monthlyComm, monthlyAgents] = await Promise.all([
      query(`SELECT TO_CHAR(submitted_at,'YYYY-MM') as month,COUNT(*)::int as enrollments,COALESCE(SUM(CASE WHEN payment_status='verified' AND status='approved' THEN amount ELSE 0 END),0)::int as revenue FROM enrollments WHERE submitted_at>=NOW()-($1||' months')::INTERVAL GROUP BY month ORDER BY month ASC`, [months]),
      query(`SELECT TO_CHAR(processed_at,'YYYY-MM') as month,COALESCE(SUM(amount),0)::int as paid FROM withdrawal_requests WHERE status='paid' AND processed_at>=NOW()-($1||' months')::INTERVAL GROUP BY month ORDER BY month ASC`, [months]),
      query(`SELECT TO_CHAR(submitted_at,'YYYY-MM') as month,COUNT(*)::int as agents,COALESCE(SUM(CASE WHEN payment_status='verified' AND status='approved' THEN amount ELSE 0 END),0)::int as entry_fees FROM referral_applications WHERE submitted_at>=NOW()-($1||' months')::INTERVAL GROUP BY month ORDER BY month ASC`, [months])
    ]);

    const monthRange = [];
    for (let i=months-1; i>=0; i--) {
      const d = new Date(); d.setMonth(d.getMonth()-i);
      monthRange.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }

    const enrollMap = Object.fromEntries(monthlyEnr.rows.map(r=>[r.month,r]));
    const commMap   = Object.fromEntries(monthlyComm.rows.map(r=>[r.month,r]));
    const agentMap  = Object.fromEntries(monthlyAgents.rows.map(r=>[r.month,r]));

    const chartData = monthRange.map(m => {
      const enr = enrollMap[m]||{enrollments:0,revenue:0};
      const com = commMap[m]||{paid:0};
      const agt = agentMap[m]||{agents:0,entry_fees:0};
      const totalRev = enr.revenue + agt.entry_fees;
      return { month:m, label:new Date(m+'-01').toLocaleString('default',{month:'short',year:'2-digit'}),
        revenue:totalRev, enrollment_revenue:enr.revenue, agent_revenue:agt.entry_fees,
        commissions_paid:com.paid, profit:totalRev-com.paid, enrollments:enr.enrollments, new_agents:agt.agents };
    });

    res.json({ chart_data:chartData, months });
  } catch (err) { console.error('Monthly chart error:', err); res.status(500).json({ error: 'Failed to load chart data' }); }
});

router.post('/seed-test-data', async (req, res) => {
  try {
    const courseResult = await query("SELECT * FROM courses WHERE is_published=TRUE LIMIT 1");
    const course = courseResult.rows[0];
    if (!course) return res.status(400).json({ error: 'No courses found. Create a course first.' });

    let testAgentUser;
    const existingAgent = await query("SELECT * FROM users WHERE email='testagent@crowntest.com'");
    if (existingAgent.rows.length > 0) {
      testAgentUser = existingAgent.rows[0];
    } else {
      const { user } = await findOrCreateUser({ full_name:'Test Agent', email:'testagent@crowntest.com', phone:'+254700000003', password:'Demo1234!' });
      await query('UPDATE users SET referral_code=$1 WHERE id=$2', ['TEST0001', user.id]);
      await query(`INSERT INTO referral_applications (user_id,amount,payment_status,status) VALUES ($1,500,'verified','approved')`, [user.id]);
      await grantPartnerStatus(user.id, { tier:'silver', referralCode:'TEST0001' });
      testAgentUser = (await query('SELECT * FROM users WHERE id=$1', [user.id])).rows[0];
    }

    const names = ['Alice Wanjiru','Brian Ochieng','Carol Njeri','David Kamau','Eve Akinyi','Frank Mwangi','Grace Otieno','Henry Kariuki'];
    const now = new Date();
    let enrollCreated=0, commCreated=0;

    for (let mo=5; mo>=0; mo--) {
      for (let j=0; j<2; j++) {
        const name = names[(mo*2+j)%names.length];
        const email = `testclient${mo}${j}@crowntest.com`;
        if ((await query('SELECT id FROM users WHERE email=$1',[email])).rows.length > 0) continue;

        const d = new Date(now.getFullYear(), now.getMonth()-mo, 10+j);
        const dateStr = d.toISOString();

        const { user:clientUser } = await findOrCreateUser({ full_name:name, email, phone:`+25470000099${mo}${j}`, password:'Demo1234!' });
        await query('UPDATE users SET referred_by_code=$1,status=$2 WHERE id=$3', ['TEST0001','active',clientUser.id]);

        const enr = await query(`INSERT INTO enrollments (user_id,course_id,amount,payment_status,status,welcomed,submitted_at,reviewed_at) VALUES ($1,$2,$3,'verified','approved',TRUE,$4,$4) RETURNING id`,
          [clientUser.id, course.id, course.price, dateStr]);
        enrollCreated++;

        const priorCount = (await query('SELECT COUNT(*)::int as c FROM referral_earnings WHERE referrer_user_id=$1',[testAgentUser.id])).rows[0].c;
        const isFirst = priorCount === 0;
        const amount = isFirst ? 300 : (priorCount<5 ? 200 : 250);
        const availableAfter = new Date(d.getTime()+48*3600000).toISOString();

        await query(`INSERT INTO referral_earnings (referrer_user_id,referred_email,referred_name,amount,commission_type,status,available_after,source_type,source_id,created_at) VALUES ($1,$2,$3,$4,$5,'available',$6,'enrollment',$7,$8)`,
          [testAgentUser.id, email, name, amount, isFirst?'first_referral':'standard', availableAfter, enr.rows[0].id, dateStr]);
        commCreated++;
      }
    }

    // Past withdrawals for the test agent
    if ((await query('SELECT COUNT(*)::int as c FROM withdrawal_requests WHERE referrer_user_id=$1',[testAgentUser.id])).rows[0].c === 0) {
      const d1 = new Date(now.getFullYear(),now.getMonth()-3,15).toISOString();
      const d2 = new Date(now.getFullYear(),now.getMonth()-1,20).toISOString();
      await query(`INSERT INTO withdrawal_requests (referrer_user_id,amount,mpesa_number,mpesa_name,status,mpesa_code,requested_at,processed_at) VALUES ($1,600,'0712000001','Test Agent','paid','QBX123TEST',$2,$2)`, [testAgentUser.id,d1]);
      await query(`INSERT INTO withdrawal_requests (referrer_user_id,amount,mpesa_number,mpesa_name,status,mpesa_code,requested_at,processed_at) VALUES ($1,800,'0712000001','Test Agent','paid','RCY456TEST',$2,$2)`, [testAgentUser.id,d2]);
    }

    res.json({ message:'Test data generated successfully!', enrollments_created:enrollCreated, commissions_created:commCreated,
      test_accounts:{ client:'testclient00@crowntest.com / Demo1234!', agent:'testagent@crowntest.com / Demo1234!' } });
  } catch (err) { console.error('Seed error:', err); res.status(500).json({ error: 'Failed to generate test data: '+err.message }); }
});

module.exports = router;
