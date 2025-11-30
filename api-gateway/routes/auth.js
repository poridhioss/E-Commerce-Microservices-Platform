/**
 * Authentication Routes
 * Handles user login and token generation
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const config = require('../../shared/config');

const router = express.Router();

/**
 * POST /api/auth/login
 * Authenticates user and returns JWT token
 */
router.post(
  '/login',
  [
    body('username').notEmpty().trim(),
    body('password').notEmpty(),
    body('tier').optional().isIn(['standard', 'premium']),
    body('region').optional().isIn(['us', 'eu', 'asia']),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { username, password, tier = 'standard', region = 'us' } = req.body;

    // In production, validate against database
    // For demo purposes, we accept any credentials
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password required',
      });
    }

    // Create JWT payload
    const payload = {
      userId: `user_${Date.now()}`,
      username,
      tier,
      region,
      device: req.get('user-agent')?.includes('Mobile') ? 'mobile' : 'desktop',
    };

    // Sign token
    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    res.json({
      success: true,
      data: {
        token,
        user: payload,
        expiresIn: config.jwt.expiresIn,
      },
    });
  }
);

/**
 * POST /api/auth/refresh
 * Refreshes JWT token
 */
router.post('/refresh', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Token required',
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // Create new token with updated expiry
    const newPayload = {
      userId: decoded.userId,
      username: decoded.username,
      tier: decoded.tier,
      region: decoded.region,
      device: decoded.device,
    };

    const newToken = jwt.sign(newPayload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    res.json({
      success: true,
      data: {
        token: newToken,
        expiresIn: config.jwt.expiresIn,
      },
    });
  } catch (error) {
    res.status(403).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }
});

module.exports = router;
