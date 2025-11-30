/**
 * Audit Service
 * Logs all events for compliance and audit trail
 * Demonstrates: Fanout Exchange (consumer), Immutable event storage
 */

const express = require('express');
const RabbitMQClient = require('../../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../../shared/logger');
const config = require('../../shared/config');

// Initialize
const app = express();
const logger = createLogger('audit-service');
const rabbitMQ = new RabbitMQClient('audit-service');

// In-memory audit log storage (use append-only database in production like EventStore)
const auditLog = [];

// Middleware
app.use(express.json());

/**
 * Creates audit record
 */
async function logAuditEvent(event) {
  try {
    // Create immutable audit record
    const auditRecord = {
      auditId: `AUDIT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      eventType: event.eventType,
      orderId: event.orderId,
      userId: event.userId,
      data: { ...event },
      timestamp: new Date().toISOString(),
      hash: generateHash(event), // In production, use cryptographic hash
    };

    // Append to audit log (immutable)
    auditLog.push(auditRecord);

    logger.info('Audit event logged', {
      auditId: auditRecord.auditId,
      eventType: event.eventType,
      orderId: event.orderId,
    });

    // In production: Store in append-only database, send to SIEM, etc.
  } catch (error) {
    logError(logger, error, {
      eventType: event.eventType,
      orderId: event.orderId,
    });
  }
}

/**
 * Generates simple hash for audit record
 * In production, use cryptographic hash (SHA-256)
 */
function generateHash(data) {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'audit-service',
    status: 'healthy',
    rabbitmq: rabbitMQ.isHealthy() ? 'connected' : 'disconnected',
    auditRecords: auditLog.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get audit log endpoint (with pagination)
 */
app.get('/audit', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  const records = auditLog.slice(offset, offset + limit);

  res.json({
    success: true,
    data: records,
    pagination: {
      offset,
      limit,
      total: auditLog.length,
    },
  });
});

/**
 * Get audit records by order ID
 */
app.get('/audit/order/:orderId', (req, res) => {
  const records = auditLog.filter(record => record.orderId === req.params.orderId);

  res.json({
    success: true,
    data: records,
  });
});

/**
 * Get audit records by event type
 */
app.get('/audit/type/:eventType', (req, res) => {
  const records = auditLog.filter(record => record.eventType === req.params.eventType);

  res.json({
    success: true,
    data: records,
  });
});

/**
 * Get audit records by user ID
 */
app.get('/audit/user/:userId', (req, res) => {
  const records = auditLog.filter(record => record.userId === req.params.userId);

  res.json({
    success: true,
    data: records,
  });
});

/**
 * Get audit records by date range
 */
app.get('/audit/range', (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({
      success: false,
      error: 'from and to query parameters required (ISO date format)',
    });
  }

  const records = auditLog.filter(record => {
    const recordDate = new Date(record.timestamp);
    return recordDate >= new Date(from) && recordDate <= new Date(to);
  });

  res.json({
    success: true,
    data: records,
    count: records.length,
  });
});

/**
 * Get audit statistics
 */
app.get('/audit/stats', (req, res) => {
  const eventTypes = {};
  const userActivity = {};

  auditLog.forEach(record => {
    // Count by event type
    eventTypes[record.eventType] = (eventTypes[record.eventType] || 0) + 1;

    // Count by user
    if (record.userId) {
      userActivity[record.userId] = (userActivity[record.userId] || 0) + 1;
    }
  });

  res.json({
    success: true,
    data: {
      totalRecords: auditLog.length,
      eventTypes,
      userActivity,
      oldestRecord: auditLog[0]?.timestamp,
      newestRecord: auditLog[auditLog.length - 1]?.timestamp,
    },
  });
});

/**
 * Verify audit record integrity
 */
app.get('/audit/verify/:auditId', (req, res) => {
  const record = auditLog.find(r => r.auditId === req.params.auditId);

  if (!record) {
    return res.status(404).json({
      success: false,
      error: 'Audit record not found',
    });
  }

  // Recalculate hash
  const calculatedHash = generateHash(record.data);
  const isValid = calculatedHash === record.hash;

  res.json({
    success: true,
    data: {
      auditId: record.auditId,
      isValid,
      storedHash: record.hash,
      calculatedHash,
      message: isValid ? 'Record integrity verified' : 'Record integrity compromised',
    },
  });
});

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully');

  // In production: flush pending writes to database
  logger.info('Final audit log size', { records: auditLog.length });

  await rabbitMQ.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Initialize service
 */
async function start() {
  try {
    // Connect to RabbitMQ
    await rabbitMQ.connect();

    // Consume from audit queue (Fanout Exchange)
    await rabbitMQ.consume(config.queues.ordersAudit, async (message) => {
      await logAuditEvent(message);
    });

    logger.info('Started consuming audit events', {
      queue: config.queues.ordersAudit,
      exchange: config.exchanges.ordersFanout,
    });

    // Start HTTP server
    const port = config.services.audit.port;
    app.listen(port, () => {
      logServiceStart(logger, 'Audit Service', port);
    });
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
