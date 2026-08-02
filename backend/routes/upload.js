const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { authenticateToken } = require('../middleware/auth');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
    allowed.includes(file.mimetype) ? cb(null,true) : cb(new Error('Only images and PDFs allowed'));
  }
});

function toCloud(buffer, options={}) {
  return new Promise((resolve,reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err,result) => err?reject(err):resolve(result));
    stream.end(buffer);
  });
}

// Payment proof upload — no auth required (used before login)
router.post('/payment-proof', upload.single('proof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await toCloud(req.file.buffer, { folder:'crowntrade/payment-proofs', resource_type:'auto' });
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message||'Upload failed' }); }
});

// Avatar upload — auth required
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await toCloud(req.file.buffer, {
      folder:'crowntrade/avatars', resource_type:'image',
      transformation:[{ width:400, height:400, crop:'fill', gravity:'face', quality:'auto', fetch_format:'auto' }]
    });
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message||'Upload failed' }); }
});

// Material upload — auth required
router.post('/material', authenticateToken, upload.single('material'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const isPdf = req.file.mimetype === 'application/pdf';
    const result = await toCloud(req.file.buffer, {
      folder:'crowntrade/materials',
      resource_type: isPdf ? 'raw' : 'image'
    });
    res.json({ url: result.secure_url, public_id: result.public_id, name: req.body.name||req.file.originalname, type: isPdf?'pdf':'image' });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message||'Upload failed' }); }
});

router.use((err, req, res, next) => {
  if (err.code==='LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large — max 10MB' });
  res.status(400).json({ error: err.message||'Upload error' });
});

module.exports = router;
