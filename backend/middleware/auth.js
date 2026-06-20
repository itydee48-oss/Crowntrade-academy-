const jwt = require('jsonwebtoken');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn('⚠️  JWT_SECRET not set in environment — using fallback. Set it in Render!');
    return 'crowntraders_secret_change_in_production';
  }
  return secret;
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required — no token found in Authorization header' });
  }

  try {
    const decoded = jwt.verify(token, getSecret());
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT verify failed:', err.message, '| Token prefix:', token.substring(0, 20));
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expired — please log in again' });
    }
    return res.status(403).json({ error: 'Invalid token — please log in again' });
  }
}

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      console.error('Admin required but role is:', req.user?.role);
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    authenticateToken(req, res, () => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: `Access restricted to: ${roles.join(', ')}` });
      }
      next();
    });
  };
}

function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

module.exports = { authenticateToken, requireAdmin, requireRole, generateToken };
