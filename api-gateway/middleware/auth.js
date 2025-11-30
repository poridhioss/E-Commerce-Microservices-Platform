/**
 * Authentication Middleware
 * Validates JWT tokens for protected routes
 */

const jwt = require('jsonwebtoken');
const config = require('../../shared/config');

/**
 * Middleware to verify JWT token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required',
    });
  }

  jwt.verify(token, config.jwt.secret, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }

    req.user = user;
    next();
  });
}

/**
 * Middleware to check user tier (for headers exchange demo)
 */
function checkUserTier(requiredTier) {
  return (req, res, next) => {
    if (!req.user || req.user.tier !== requiredTier) {
      return res.status(403).json({
        success: false,
        error: `${requiredTier} tier required`,
      });
    }
    next();
  };
}

module.exports = {
  authenticateToken,
  checkUserTier,
};
