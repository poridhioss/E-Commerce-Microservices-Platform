/**
 * API Gateway Service
 * Entry point for all client requests
 * Handles authentication, rate limiting, and message publishing to RabbitMQ
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Import shared modules
const RabbitMQClient = require('../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../shared/logger');
const config = require('../shared/config');

// Import routes
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const healthRoutes = require('./routes/health');

// Initialize
const app = express();
const logger = createLogger('api-gateway');
const rabbitMQ = new RabbitMQClient('api-gateway');

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});

app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Make RabbitMQ client available to routes
app.set('rabbitMQ', rabbitMQ);
app.set('logger', logger);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/health', healthRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logError(logger, err, {
    method: req.method,
    path: req.path,
  });

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await rabbitMQ.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await rabbitMQ.close();
  process.exit(0);
});

// Start server
async function start() {
  try {
    // Connect to RabbitMQ
    await rabbitMQ.connect();

    // Start HTTP server
    const port = config.services.apiGateway.port;
    app.listen(port, () => {
      logServiceStart(logger, 'API Gateway', port);
    });
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
