/**
 * Health Check Routes
 * Provides health and readiness endpoints
 */

const express = require('express');
const router = express.Router();

/**
 * GET /health
 * Basic health check
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'api-gateway',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready
 * Readiness probe (checks RabbitMQ connection)
 */
router.get('/ready', (req, res) => {
  const rabbitMQ = req.app.get('rabbitMQ');

  if (rabbitMQ && rabbitMQ.isHealthy()) {
    res.json({
      success: true,
      service: 'api-gateway',
      status: 'ready',
      rabbitmq: 'connected',
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      success: false,
      service: 'api-gateway',
      status: 'not ready',
      rabbitmq: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /health/live
 * Liveness probe
 */
router.get('/live', (req, res) => {
  res.json({
    success: true,
    service: 'api-gateway',
    status: 'alive',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
