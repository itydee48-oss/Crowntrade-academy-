const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

router.get('/overview', requireAdmin, async (req, res) => {
  try {
    const [enrRev, refRev, commPaid, commAvail, commPending, courses] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount),0)::int as total, COUNT(*)::int as count FROM enrollments WHERE payment_status='verified'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as total FROM referral_applications WHERE payment_status='verified'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as total FROM referral_earnings WHERE status='paid'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as total FROM referral_earnings WHERE status='available'`),
      query(`SELECT COALESCE(SUM(amount),0)::int as total FROM referral_earnings WHERE status='pending'`),
      query(`SELECT c.title, COUNT(e.id)::int as enrollments, COALESCE(SUM(e.amount),0)::int as revenue
        FROM courses c LEFT JOIN enrollments e ON e.course_id=c.id AND e.payment_status='verified'
        GROUP BY c.id ORDER BY revenue DESC`)
    ]);
    const totalRevenue = enrRev.rows[0].total + refRev.rows[0].total;
    const commissionsPaid = commPaid.rows[0].total;
    res.json({
      revenue: { total: totalRevenue, enrollment_fees: enrRev.rows[0].total, agent_entry_fees: refRev.rows[0].total, enrollment_count: enrRev.rows[0].count, agent_count: 0 },
      commissions: { paid: commissionsPaid, available: commAvail.rows[0].total, pending: commPending.rows[0].total, total_owed: commAvail.rows[0].total + commPending.rows[0].total + commissionsPaid },
      profit: { gross: totalRevenue - commissionsPaid, commission_ratio: totalRevenue > 0 ? Math.round(commissionsPaid/totalRevenue*100) : 0 },
      course_breakdown: courses.rows
    });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to get ledger' }); }
});

router.get('/monthly', requireAdmin, async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const r = await query(`SELECT TO_CHAR(submitted_at,'Mon') as label, TO_CHAR(submitted_at,'YYYY-MM') as month,
      COALESCE(SUM(amount),0)::int as revenue, COUNT(*)::int as count
      FROM enrollments WHERE payment_status='verified' AND submitted_at >= NOW() - INTERVAL '${months} months'
      GROUP BY month,label ORDER BY month`);
    res.json({ chart_data: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get monthly data' }); }
});

module.exports = router;
