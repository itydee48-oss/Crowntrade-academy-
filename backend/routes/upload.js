const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { authenticateToken } = require('../middleware/auth');

// ── CLOUDINARY CONFIG ──────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Use memory storage — file goes straight to Cloudinary, never touches disk
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images and PDFs are allowed'));
  }
});

// ── HELPER: upload buffer to Cloudinary ───────────────────────────────────
function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

// ── PAYMENT PROOF UPLOAD ───────────────────────────────────────────────────
// Used by clients uploading payment screenshots
router.post('/payment-proof', upload.single('proof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: 'crowntrade/payment-proofs',
      resource_type: 'auto', // handles both images and PDFs
      transformation: req.file.mimetype.startsWith('image/') ? [
        { width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
      ] : undefined
    });

    res.json({
      url: result.secure_url,
      public_id: result.public_id,
      resource_type: result.resource_type,
      format: result.format,
      bytes: result.bytes
    });
  } catch (err) {
    console.error('Payment proof upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ── AVATAR UPLOAD ──────────────────────────────────────────────────────────
// Used by mentors uploading profile pictures
// Supports crop coordinates from the frontend (x, y, width, height as % of original)
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Parse crop data if provided by frontend crop tool
    let transformation = [
      { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' }
    ];

    if (req.body.crop_x !== undefined) {
      // Custom crop coordinates sent from frontend crop UI
      const x = parseFloat(req.body.crop_x);
      const y = parseFloat(req.body.crop_y);
      const w = parseFloat(req.body.crop_width);
      const h = parseFloat(req.body.crop_height);
      transformation = [
        { x, y, width: w, height: h, crop: 'crop' },
        { width: 400, height: 400, crop: 'fill', quality: 'auto', fetch_format: 'auto' }
      ];
    }

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: 'crowntrade/avatars',
      transformation,
      resource_type: 'image'
    });

    res.json({
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height
    });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: err.message || 'Avatar upload failed' });
  }
});

// ── COURSE MATERIAL UPLOAD ─────────────────────────────────────────────────
// Used by mentors uploading PDFs and images as course materials
router.post('/material', authenticateToken, upload.single('material'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const isPdf = req.file.mimetype === 'application/pdf';

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: 'crowntrade/materials',
      resource_type: isPdf ? 'raw' : 'image',
      transformation: isPdf ? undefined : [
        { width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
      ]
    });

    res.json({
      url: result.secure_url,
      public_id: result.public_id,
      name: req.body.name || req.file.originalname,
      type: isPdf ? 'pdf' : 'image',
      bytes: result.bytes
    });
  } catch (err) {
    console.error('Material upload error:', err);
    res.status(500).json({ error: err.message || 'Material upload failed' });
  }
});

// ── ERROR HANDLER ──────────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large — maximum 10MB' });
  res.status(400).json({ error: err.message || 'Upload error' });
});

module.exports = router;
