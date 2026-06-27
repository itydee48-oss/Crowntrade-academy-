const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDB } = require('./database/db');
const authRoutes = require('./routes/auth');
const mentorshipRoutes = require('./routes/mentorship');
const { router: referralRoutes } = require('./routes/referral');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const coursesRoutes = require('./routes/courses');
const enrollmentsRoutes = require('./routes/enrollments');
const ledgerRoutes = require('./routes/ledger');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',  // Allow all origins — fine for this project
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── DEBUG: Token verify endpoint ─────────────────────────────────────────────
// Visit: https://crowntrade-academy-phai.onrender.com/api/auth/verify-token
// with Authorization: Bearer <your_token> to test if your token works
app.get('/api/auth/verify-token', (req, res) => {
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'crowntraders_secret_change_in_production';
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.json({ ok: false, error: 'No token provided', hint: 'Send Authorization: Bearer <token>' });
  }

  try {
    const decoded = jwt.verify(token, secret);
    res.json({ ok: true, decoded, secret_length: secret.length });
  } catch (err) {
    res.json({ ok: false, error: err.message, name: err.name, token_prefix: token.substring(0, 30) });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/mentorship', mentorshipRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/enrollments', enrollmentsRoutes);
app.use('/api/ledger', ledgerRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Crown Trade Academy API running',
    jwt_secret_set: !!process.env.JWT_SECRET,
    node_version: process.version
  });
});

// 404 for unknown API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔑 JWT_SECRET set: ${!!process.env.JWT_SECRET}`);
    console.log(`🌍 CORS: open to all origins`);
  });
}).catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});

module.exports = app;
