require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./database/db');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── ROUTES ──────────────────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const adminRoutes       = require('./routes/admin');
const mentorshipRoutes  = require('./routes/mentorship');
const { router: referralRoutes } = require('./routes/referral');
const enrollmentRoutes  = require('./routes/enrollments');
const courseRoutes      = require('./routes/courses');
const uploadRoutes      = require('./routes/upload');
const ledgerRoutes      = require('./routes/ledger');
const quizRoutes        = require('./routes/quiz');
const sessionRoutes     = require('./routes/sessions');
const journalRoutes     = require('./routes/journal');
const mentorRoutes      = require('./routes/mentor');
const migrateRoutes     = require('./routes/migrate');

app.use('/api/auth',        authRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/mentorship',  mentorshipRoutes);
app.use('/api/referral',    referralRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/courses',     courseRoutes);
app.use('/api/upload',      uploadRoutes);
app.use('/api/ledger',      ledgerRoutes);
app.use('/api/quiz',        quizRoutes);
app.use('/api/sessions',    sessionRoutes);
app.use('/api/journal',     journalRoutes);
app.use('/api/mentor',      mentorRoutes);
app.use('/api/migrate',     migrateRoutes);

// ── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status:'ok', message:'Crown Trade Academy API running', jwt_secret_set:!!process.env.JWT_SECRET, node_version:process.version });
});

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error:`Route not found: ${req.method} ${req.originalUrl}` });
});

// ── BOOT ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🔑 JWT_SECRET set: ${!!process.env.JWT_SECRET}`);
    });
  })
  .catch(err => {
    console.error('❌ Database init failed:', err);
    process.exit(1);
  });
