const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const PESAPAL_BASE = process.env.PESAPAL_ENV === 'live'
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';
const BACKEND_URL = process.env.BACKEND_URL || 'https://crowntrade-academy-phai.onrender.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://itydee48-oss.github.io/Crowntrade-academy-';

let _tokenCache = { token: null, expiry: 0 };
let _ipnId = process.env.PESAPAL_IPN_ID || null;

async function getPesapalToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiry) return _tokenCache.token;
  const res = await fetch(`${PESAPAL_BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ consumer_key: process.env.PESAPAL_CONSUMER_KEY, consumer_secret: process.env.PESAPAL_CONSUMER_SECRET })
  });
  if (!res.ok) throw new Error(`Pesapal auth failed: ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error('No token from Pesapal');
  _tokenCache = { token: data.token, expiry: Date.now() + 4 * 60 * 1000 };
  return data.token;
}

async function ensureIpnRegistered() {
  if (_ipnId) return _ipnId;
  try {
    const token = await getPesapalToken();
    const ipnUrl = `${BACKEND_URL}/api/payments/ipn`;
    const listRes = await fetch(`${PESAPAL_BASE}/api/URLSetup/GetIpnList`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    if (listRes.ok) {
      const list = await listRes.json();
      const existing = (list || []).find(i => i.url === ipnUrl);
      if (existing) { _ipnId = existing.ipn_id; console.log('✅ IPN already registered:', _ipnId); return _ipnId; }
    }
    const regRes = await fetch(`${PESAPAL_BASE}/api/URLSetup/RegisterIPN`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'GET' })
    });
    if (!regRes.ok) { console.error('IPN reg failed:', await regRes.text()); return null; }
    const regData = await regRes.json();
    _ipnId = regData.ipn_id;
    console.log('✅ IPN registered:', _ipnId);
    return _ipnId;
  } catch(err) { console.error('IPN error:', err.message); return null; }
}

// INITIATE PAYMENT
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const { enrollment_id, mentorship_application_id, referral_application_id } = req.body;
    let amount, description, orderId, callbackRef;
    const userResult = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (enrollment_id) {
      const r = await query(`SELECT e.*,c.title as course_title FROM enrollments e
        JOIN courses c ON e.course_id=c.id WHERE e.id=$1 AND e.user_id=$2`, [enrollment_id, req.user.id]);
      const e = r.rows[0];
      if (!e) return res.status(404).json({ error: 'Enrollment not found' });
      amount = e.amount || 3500;
      description = `Crown Trade Academy — ${e.course_title}`;
      orderId = `ENR-${enrollment_id}-${Date.now()}`;
      callbackRef = `enrollment:${enrollment_id}`;
    } else if (mentorship_application_id) {
      const r = await query('SELECT * FROM mentorship_applications WHERE id=$1 AND user_id=$2', [mentorship_application_id, req.user.id]);
      const m = r.rows[0];
      if (!m) return res.status(404).json({ error: 'Application not found' });
      amount = m.amount || 3500;
      description = 'Crown Trade Academy — Elite Mentorship';
      orderId = `MENT-${mentorship_application_id}-${Date.now()}`;
      callbackRef = `mentorship:${mentorship_application_id}`;
    } else if (referral_application_id) {
      const r = await query('SELECT * FROM referral_applications WHERE id=$1 AND user_id=$2', [referral_application_id, req.user.id]);
      const a = r.rows[0];
      if (!a) return res.status(404).json({ error: 'Application not found' });
      amount = a.amount || 500;
      description = 'Crown Trade Academy — Crown Partner Registration';
      orderId = `REF-${referral_application_id}-${Date.now()}`;
      callbackRef = `referral:${referral_application_id}`;
    } else {
      return res.status(400).json({ error: 'Specify enrollment_id, mentorship_application_id, or referral_application_id' });
    }

    const token = await getPesapalToken();
    const ipnId = await ensureIpnRegistered();
    if (!ipnId) return res.status(500).json({ error: 'Payment system not configured. Contact support.' });

    const nameParts = (user.full_name || 'Crown User').split(' ');
    const orderPayload = {
      id: orderId, currency: 'KES', amount: parseFloat(amount), description,
      callback_url: `${FRONTEND_URL}/payment-callback.html?ref=${encodeURIComponent(callbackRef)}`,
      notification_id: ipnId,
      billing_address: {
        email_address: user.email,
        phone_number: (user.phone || '').replace(/\D/g,''),
        first_name: nameParts[0],
        last_name: nameParts.slice(1).join(' ') || nameParts[0],
        line_1: 'Nairobi', city: 'Nairobi', country_code: 'KE'
      }
    };

    const orderRes = await fetch(`${PESAPAL_BASE}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    if (!orderRes.ok) { const t = await orderRes.text(); console.error('Order failed:', t); return res.status(500).json({ error: 'Payment initiation failed' }); }
    const orderData = await orderRes.json();

    await query(`INSERT INTO payments (user_id,order_id,order_tracking_id,amount,description,callback_ref,status)
      VALUES ($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT (order_id) DO UPDATE SET order_tracking_id=$3,status='pending'`,
      [req.user.id, orderId, orderData.order_tracking_id, amount, description, callbackRef]);

    res.json({ redirect_url: orderData.redirect_url, order_tracking_id: orderData.order_tracking_id, order_id: orderId });
  } catch(err) { console.error('Payment initiate error:', err); res.status(500).json({ error: err.message || 'Payment failed' }); }
});

// IPN HANDLER
router.get('/ipn', async (req, res) => {
  try {
    const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } = req.query;
    if (!OrderTrackingId) return res.json({ status: '500' });
    const token = await getPesapalToken();
    const statusRes = await fetch(`${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      if (statusData.payment_status_description === 'Completed') {
        await processPayment(OrderMerchantReference, OrderTrackingId, statusData);
      }
    }
    res.json({ orderNotificationType: OrderNotificationType, orderTrackingId: OrderTrackingId, orderMerchantReference: OrderMerchantReference, status: '200' });
  } catch(err) { console.error('IPN error:', err); res.json({ status: '500' }); }
});

// CALLBACK
router.get('/callback', async (req, res) => {
  try {
    const { OrderTrackingId, OrderMerchantReference } = req.query;
    if (!OrderTrackingId) return res.status(400).json({ error: 'Missing tracking ID' });
    const token = await getPesapalToken();
    const statusRes = await fetch(`${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    const statusData = await statusRes.json();
    const isPaid = statusData.payment_status_description === 'Completed';
    if (isPaid) await processPayment(OrderMerchantReference, OrderTrackingId, statusData);
    res.json({ paid: isPaid, status: statusData.payment_status_description, amount: statusData.amount, currency: statusData.currency, payment_method: statusData.payment_method });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// STATUS CHECK
router.get('/status/:trackingId', authenticateToken, async (req, res) => {
  try {
    const token = await getPesapalToken();
    const r = await fetch(`${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${req.params.trackingId}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    res.json(await r.json());
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// MY PAYMENTS
router.get('/my-payments', authenticateToken, async (req, res) => {
  try {
    const r = await query('SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ payments: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get payments' }); }
});

// ADMIN: ALL PAYMENTS
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT p.*,u.full_name,u.email,u.member_number FROM payments p
      JOIN users u ON p.user_id=u.id ORDER BY p.created_at DESC LIMIT 200`);
    res.json({ payments: r.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to get payments' }); }
});

async function processPayment(orderId, trackingId, statusData) {
  try {
    await query(`UPDATE payments SET status='completed',tracking_id=$1,payment_method=$2,paid_at=CURRENT_TIMESTAMP WHERE order_id=$3`,
      [trackingId, statusData.payment_method||'pesapal', orderId]);
    const payResult = await query('SELECT * FROM payments WHERE order_id=$1', [orderId]);
    const payment = payResult.rows[0];
    if (!payment) return;
    const [type, id] = payment.callback_ref.split(':');
    const refId = parseInt(id);

    if (type === 'enrollment') {
      await query(`UPDATE enrollments SET payment_status='verified',status='approved',
        payment_proof=$1,reviewed_at=CURRENT_TIMESTAMP WHERE id=$2`, [`pesapal:${trackingId}`, refId]);
      const enrResult = await query(`SELECT e.user_id,c.is_flagship FROM enrollments e
        JOIN courses c ON e.course_id=c.id WHERE e.id=$1`, [refId]);
      if (enrResult.rows[0]?.is_flagship) {
        await query('UPDATE users SET has_mentorship=TRUE WHERE id=$1', [enrResult.rows[0].user_id]);
      }
      console.log(`✅ Enrollment ${refId} auto-approved`);
    } else if (type === 'mentorship') {
      await query(`UPDATE mentorship_applications SET payment_status='verified',status='approved',
        payment_proof=$1,reviewed_at=CURRENT_TIMESTAMP WHERE id=$2`, [`pesapal:${trackingId}`, refId]);
      const appResult = await query('SELECT user_id FROM mentorship_applications WHERE id=$1', [refId]);
      if (appResult.rows[0]) {
        await query('UPDATE users SET has_mentorship=TRUE WHERE id=$1', [appResult.rows[0].user_id]);
      }
      console.log(`✅ Mentorship ${refId} auto-approved`);
    } else if (type === 'referral') {
      await query(`UPDATE referral_applications SET payment_status='verified',status='approved',
        payment_proof=$1,reviewed_at=CURRENT_TIMESTAMP WHERE id=$2`, [`pesapal:${trackingId}`, refId]);
      const appResult = await query('SELECT user_id FROM referral_applications WHERE id=$1', [refId]);
      if (appResult.rows[0]) {
        await query('UPDATE users SET has_partner_status=TRUE WHERE id=$1', [appResult.rows[0].user_id]);
      }
      console.log(`✅ Partner ${refId} auto-approved`);
    }
  } catch(err) { console.error('processPayment error:', err); }
}

module.exports = { router, ensureIpnRegistered };
