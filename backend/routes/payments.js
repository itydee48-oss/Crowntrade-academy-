const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { grantMentorship } = require('../database/identity');

// ── CONFIG ─────────────────────────────────────────────────────────────────
const PESAPAL_BASE = process.env.PESAPAL_ENV === 'live'
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

const BACKEND_URL = process.env.BACKEND_URL || 'https://crowntrade-academy-phai.onrender.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://itydee48-oss.github.io/Crowntrade-academy-';

// ── TOKEN CACHE ────────────────────────────────────────────────────────────
let _tokenCache = { token: null, expiry: 0 };

async function getPesapalToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiry) return _tokenCache.token;

  const res = await fetch(`${PESAPAL_BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pesapal auth failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.token) throw new Error('No token in Pesapal auth response');

  // Cache for 4 minutes (tokens expire in 5)
  _tokenCache = { token: data.token, expiry: Date.now() + 4 * 60 * 1000 };
  return data.token;
}

// ── IPN REGISTRATION ───────────────────────────────────────────────────────
// Called once on server boot to register/confirm our IPN URL with Pesapal
// and get back the IPN ID we need for order submissions
let _ipnId = process.env.PESAPAL_IPN_ID || null;

async function ensureIpnRegistered() {
  if (_ipnId) return _ipnId;
  try {
    const token = await getPesapalToken();
    const ipnUrl = `${BACKEND_URL}/api/payments/ipn`;

    // First check if already registered
    const listRes = await fetch(`${PESAPAL_BASE}/api/URLSetup/GetIpnList`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      const existing = (listData || []).find(ipn => ipn.url === ipnUrl);
      if (existing) { _ipnId = existing.ipn_id; console.log('✅ Pesapal IPN already registered:', _ipnId); return _ipnId; }
    }

    // Register new IPN
    const regRes = await fetch(`${PESAPAL_BASE}/api/URLSetup/RegisterIPN`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'GET' })
    });

    if (!regRes.ok) {
      const text = await regRes.text();
      console.error('IPN registration failed:', text);
      return null;
    }

    const regData = await regRes.json();
    _ipnId = regData.ipn_id;
    console.log('✅ Pesapal IPN registered:', _ipnId);
    return _ipnId;
  } catch(err) {
    console.error('IPN registration error:', err.message);
    return null;
  }
}

// ── INITIATE PAYMENT ───────────────────────────────────────────────────────
// Called when a student wants to pay for an enrollment or mentorship
// Returns a redirect URL to the Pesapal checkout page
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const { enrollment_id, mentorship_application_id, referral_application_id } = req.body;

    // Determine what's being paid for
    let amount, description, orderId, callbackRef;

    if (enrollment_id) {
      const result = await query(`
        SELECT e.*, c.title as course_title, u.full_name, u.email, u.phone
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        JOIN users u ON u.id = e.user_id
        WHERE e.id = $1 AND e.user_id = $2
      `, [enrollment_id, req.user.id]);
      const e = result.rows[0];
      if (!e) return res.status(404).json({ error: 'Enrollment not found' });
      amount = e.amount || e.course_price;
      description = `Crown Trade Academy — ${e.course_title}`;
      orderId = `ENR-${enrollment_id}-${Date.now()}`;
      callbackRef = `enrollment:${enrollment_id}`;
    } else if (mentorship_application_id) {
      const result = await query(`
        SELECT ma.*, u.full_name, u.email, u.phone
        FROM mentorship_applications ma JOIN users u ON u.id = ma.user_id
        WHERE ma.id = $1 AND ma.user_id = $2
      `, [mentorship_application_id, req.user.id]);
      const m = result.rows[0];
      if (!m) return res.status(404).json({ error: 'Application not found' });
      amount = m.amount || 3500;
      description = 'Crown Trade Academy — Elite Mentorship Program';
      orderId = `MENT-${mentorship_application_id}-${Date.now()}`;
      callbackRef = `mentorship:${mentorship_application_id}`;
    } else if (referral_application_id) {
      const result = await query(`
        SELECT ra.*, u.full_name, u.email, u.phone
        FROM referral_applications ra JOIN users u ON u.id = ra.user_id
        WHERE ra.id = $1 AND ra.user_id = $2
      `, [referral_application_id, req.user.id]);
      const r = result.rows[0];
      if (!r) return res.status(404).json({ error: 'Application not found' });
      amount = r.amount || 500;
      description = 'Crown Trade Academy — Crown Partner Registration';
      orderId = `REF-${referral_application_id}-${Date.now()}`;
      callbackRef = `referral:${referral_application_id}`;
    } else {
      return res.status(400).json({ error: 'Specify enrollment_id, mentorship_application_id, or referral_application_id' });
    }

    // Get user details
    const userResult = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];

    const token = await getPesapalToken();
    const ipnId = await ensureIpnRegistered();

    if (!ipnId) return res.status(500).json({ error: 'Payment system not configured. Contact support.' });

    // Submit order to Pesapal
    const orderPayload = {
      id: orderId,
      currency: 'KES',
      amount: parseFloat(amount),
      description,
      callback_url: `${FRONTEND_URL}/payment-callback.html?ref=${encodeURIComponent(callbackRef)}`,
      notification_id: ipnId,
      billing_address: {
        email_address: user.email,
        phone_number: user.phone || '',
        first_name: user.full_name.split(' ')[0],
        last_name: user.full_name.split(' ').slice(1).join(' ') || user.full_name.split(' ')[0],
        line_1: 'Nairobi',
        city: 'Nairobi',
        country_code: 'KE'
      }
    };

    const orderRes = await fetch(`${PESAPAL_BASE}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    if (!orderRes.ok) {
      const text = await orderRes.text();
      console.error('Pesapal order submission failed:', text);
      return res.status(500).json({ error: 'Payment initiation failed. Try again.' });
    }

    const orderData = await orderRes.json();

    // Save pending payment record
    await query(`
      INSERT INTO payments (user_id, order_id, order_tracking_id, amount, description, callback_ref, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      ON CONFLICT (order_id) DO UPDATE SET order_tracking_id = $3, status = 'pending'
    `, [req.user.id, orderId, orderData.order_tracking_id, amount, description, callbackRef]);

    res.json({
      redirect_url: orderData.redirect_url,
      order_tracking_id: orderData.order_tracking_id,
      order_id: orderId
    });
  } catch(err) {
    console.error('Payment initiation error:', err);
    res.status(500).json({ error: err.message || 'Payment initiation failed' });
  }
});

// ── IPN HANDLER ────────────────────────────────────────────────────────────
// Pesapal calls this URL when a payment is completed
// We verify the payment then auto-unlock the course/application
router.get('/ipn', async (req, res) => {
  try {
    const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } = req.query;

    console.log('IPN received:', { OrderTrackingId, OrderMerchantReference, OrderNotificationType });

    if (!OrderTrackingId) return res.status(400).json({ error: 'Missing OrderTrackingId' });

    // Verify payment status with Pesapal
    const token = await getPesapalToken();
    const statusRes = await fetch(`${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });

    if (!statusRes.ok) {
      console.error('Status check failed:', await statusRes.text());
      return res.status(200).json({ orderNotificationType: OrderNotificationType, orderTrackingId: OrderTrackingId, orderMerchantReference: OrderMerchantReference, status: '500' });
    }

    const statusData = await statusRes.json();
    console.log('Payment status:', statusData);

    const isPaid = statusData.payment_status_description === 'Completed';

    if (isPaid) {
      await processSuccessfulPayment(OrderMerchantReference, OrderTrackingId, statusData);
    }

    // Pesapal requires this specific response format
    res.json({
      orderNotificationType: OrderNotificationType,
      orderTrackingId: OrderTrackingId,
      orderMerchantReference: OrderMerchantReference,
      status: '200'
    });
  } catch(err) {
    console.error('IPN handler error:', err);
    res.status(200).json({ status: '500' });
  }
});

// ── PAYMENT CALLBACK ────────────────────────────────────────────────────────
// Student returns here after Pesapal checkout
// We check status and show success/failure
router.get('/callback', async (req, res) => {
  try {
    const { OrderTrackingId, OrderMerchantReference } = req.query;
    if (!OrderTrackingId) return res.status(400).json({ error: 'Missing tracking ID' });

    const token = await getPesapalToken();
    const statusRes = await fetch(`${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });

    const statusData = await statusRes.json();
    const isPaid = statusData.payment_status_description === 'Completed';

    if (isPaid) await processSuccessfulPayment(OrderMerchantReference, OrderTrackingId, statusData);

    res.json({
      paid: isPaid,
      status: statusData.payment_status_description,
      amount: statusData.amount,
      currency: statusData.currency,
      payment_method: statusData.payment_method,
      order_id: OrderMerchantReference
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CHECK PAYMENT STATUS ────────────────────────────────────────────────────
router.get('/status/:trackingId', authenticateToken, async (req, res) => {
  try {
    const token = await getPesapalToken();
    const statusRes = await fetch(`${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${req.params.trackingId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const statusData = await statusRes.json();
    res.json(statusData);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET PAYMENT HISTORY (client) ─────────────────────────────────────────────
router.get('/my-payments', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ payments: result.rows });
  } catch(err) {
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// ── ADMIN: ALL PAYMENTS ───────────────────────────────────────────────────────
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, u.full_name, u.email, u.member_number
      FROM payments p JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC LIMIT 100
    `);
    res.json({ payments: result.rows });
  } catch(err) {
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// ── PROCESS SUCCESSFUL PAYMENT ─────────────────────────────────────────────
async function processSuccessfulPayment(orderId, trackingId, statusData) {
  try {
    // Update payment record
    await query(`
      UPDATE payments SET status = 'completed', tracking_id = $1, payment_method = $2, paid_at = CURRENT_TIMESTAMP
      WHERE order_id = $3
    `, [trackingId, statusData.payment_method || 'pesapal', orderId]);

    // Get the callback ref to know what to unlock
    const paymentResult = await query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
    const payment = paymentResult.rows[0];
    if (!payment) { console.error('Payment record not found for order:', orderId); return; }

    const [type, id] = payment.callback_ref.split(':');
    const refId = parseInt(id);

    if (type === 'enrollment') {
      // Auto-approve enrollment and verify payment
      await query(`
        UPDATE enrollments
        SET payment_status = 'verified', status = 'approved', payment_proof = $1, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [`pesapal:${trackingId}`, refId]);

      // Grant mentorship if this is the flagship course
      const enrResult = await query(`
        SELECT e.user_id, c.is_flagship FROM enrollments e
        JOIN courses c ON e.course_id = c.id WHERE e.id = $1
      `, [refId]);
      if (enrResult.rows[0]?.is_flagship) {
        await grantMentorship(enrResult.rows[0].user_id);
      }

      // Start referral commission 48h clock if applicable
      const enr = enrResult.rows[0];
      if (enr) {
        const availableAfter = new Date(Date.now() + 48 * 3600000).toISOString();
        await query(`
          UPDATE referral_earnings
          SET available_after = $1, status = 'pending'
          WHERE source_type = 'enrollment' AND source_id = $2 AND status = 'pending'
        `, [availableAfter, refId]);
      }

      console.log(`✅ Enrollment ${refId} auto-approved via Pesapal payment ${trackingId}`);

    } else if (type === 'mentorship') {
      // Auto-approve mentorship application
      await query(`
        UPDATE mentorship_applications
        SET payment_status = 'verified', status = 'approved', payment_proof = $1, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [`pesapal:${trackingId}`, refId]);

      const appResult = await query('SELECT user_id FROM mentorship_applications WHERE id = $1', [refId]);
      if (appResult.rows[0]) await grantMentorship(appResult.rows[0].user_id);

      console.log(`✅ Mentorship ${refId} auto-approved via Pesapal payment ${trackingId}`);

    } else if (type === 'referral') {
      // Auto-approve referral application
      await query(`
        UPDATE referral_applications
        SET payment_status = 'verified', status = 'approved', payment_proof = $1, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [`pesapal:${trackingId}`, refId]);

      await query('UPDATE referral_settings SET spots_filled = spots_filled + 1 WHERE id = 1');

      const appResult = await query('SELECT user_id, status FROM referral_applications WHERE id = $1', [refId]);
      if (appResult.rows[0]) {
        const { grantPartnerStatus } = require('../database/identity');
        const userResult = await query('SELECT referral_code FROM users WHERE id = $1', [appResult.rows[0].user_id]);
        await grantPartnerStatus(appResult.rows[0].user_id, { tier: 'bronze', referralCode: userResult.rows[0]?.referral_code });
      }

      console.log(`✅ Referral ${refId} auto-approved via Pesapal payment ${trackingId}`);
    }
  } catch(err) {
    console.error('processSuccessfulPayment error:', err);
  }
}

// Export the IPN setup function so server.js can call it on boot
module.exports = { router, ensureIpnRegistered };
