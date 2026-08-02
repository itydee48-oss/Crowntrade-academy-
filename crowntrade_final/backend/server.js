require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./database/db');
const { ensureIpnRegistered } = require('./routes/payments');

const app = express();

app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/health',      (req,res) => res.json({ status:'ok', message:'Crown Trade Academy API running', jwt_secret_set:!!process.env.JWT_SECRET, node_version:process.version }));
app.use('/api/mentorship',  require('./routes/mentorship'));
app.use('/api/referral',    require('./routes/referral'));
app.use('/api/enrollments', require('./routes/enrollments'));
app.use('/api/courses',     require('./routes/courses'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/ledger',      require('./routes/ledger'));
app.use('/api/upload',      require('./routes/upload'));
app.use('/api/mentor',      require('./routes/mentor'));
app.use('/api/sessions',    require('./routes/sessions'));
app.use('/api/journal',     require('./routes/journal'));
app.use('/api/quiz',        require('./routes/quiz'));
app.use('/api/payments',    require('./routes/payments').router);

// 404
app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  ensureIpnRegistered().catch(err => console.warn('IPN setup skipped:', err.message));
  app.listen(PORT, () => console.log(`✅ Crown Trade Academy running on port ${PORT}`));
}).catch(err => { console.error('Failed to init DB:', err); process.exit(1); });
