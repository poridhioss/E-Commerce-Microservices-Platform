/**
 * Payment Service
 * Processes payments with retry logic using Dead Letter Exchange (DLX)
 * Demonstrates: Dead Letter Exchange, Retry Logic, Error Handling
 */

const express = require('express');
const RabbitMQClient = require('../../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../../shared/logger');
const config = require('../../shared/config');

// Initialize
const app = express();
const logger = createLogger('payment-service');
const rabbitMQ = new RabbitMQClient('payment-service');

// In-memory payment storage (use database in production)
const payments = new Map();
const failedPayments = new Map();

// Middleware
app.use(express.json());

/**
 * Simulates payment processing with random failures for demo
 */
function simulatePaymentGateway(amount) {
  // 30% chance of failure for demonstration
  const random = Math.random();

  if (random < 0.3) {
    throw new Error('Payment gateway timeout');
  }

  if (random < 0.4) {
    throw new Error('Insufficient funds');
  }

  // Success
  return {
    transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: 'completed',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Processes a payment
 */
async function processPayment(paymentData, msg) {
  const retryCount = (msg.properties.headers && msg.properties.headers['x-retry-count']) || 0;

  try {
    logger.info('Processing payment', {
      orderId: paymentData.orderId,
      amount: paymentData.amount,
      retryCount,
    });

    // Simulate payment processing
    const result = simulatePaymentGateway(paymentData.amount);

    // Store successful payment
    const payment = {
      ...paymentData,
      ...result,
      retryCount,
      processedAt: new Date().toISOString(),
    };

    payments.set(paymentData.orderId, payment);

    logger.info('Payment successful', {
      orderId: paymentData.orderId,
      transactionId: result.transactionId,
      amount: paymentData.amount,
    });

    // Publish payment success event to Fanout
    await rabbitMQ.publish(
      config.exchanges.ordersFanout,
      '',
      {
        eventType: 'payment.success',
        orderId: paymentData.orderId,
        transactionId: result.transactionId,
        amount: paymentData.amount,
        timestamp: new Date().toISOString(),
      }
    );

    // Trigger shipping
    await rabbitMQ.publish(
      config.exchanges.ordersTopic,
      'shipping.create',
      {
        orderId: paymentData.orderId,
        shippingAddress: paymentData.shippingAddress || 'Default Address',
        timestamp: new Date().toISOString(),
      }
    );

  } catch (error) {
    logger.error('Payment processing failed', {
      orderId: paymentData.orderId,
      error: error.message,
      retryCount,
    });

    // Check if we should retry
    if (retryCount < config.retry.maxAttempts) {
      // Reject message with requeue to DLX for retry
      logger.info('Scheduling payment retry', {
        orderId: paymentData.orderId,
        retryCount: retryCount + 1,
        maxAttempts: config.retry.maxAttempts,
      });

      // Reject and send to DLX
      throw error; // This will cause nack and send to DLX
    } else {
      // Max retries exceeded - move to dead letter queue
      logger.error('Payment failed after max retries', {
        orderId: paymentData.orderId,
        retryCount,
        error: error.message,
      });

      // Store in failed payments
      failedPayments.set(paymentData.orderId, {
        ...paymentData,
        error: error.message,
        retryCount,
        failedAt: new Date().toISOString(),
      });

      // Publish payment failure event
      await rabbitMQ.publish(
        config.exchanges.ordersFanout,
        '',
        {
          eventType: 'payment.failed',
          orderId: paymentData.orderId,
          error: error.message,
          retryCount,
          timestamp: new Date().toISOString(),
        }
      );

      // Still throw to send to dead letter queue
      throw error;
    }
  }
}

/**
 * Handles messages from retry queue
 */
async function handleRetry(retryData, msg) {
  const currentRetryCount = (msg.properties.headers && msg.properties.headers['x-retry-count']) || 0;
  const newRetryCount = currentRetryCount + 1;

  logger.info('Handling retry', {
    orderId: retryData.orderId,
    retryCount: newRetryCount,
  });

  // Re-publish to payment processing queue with incremented retry count
  await rabbitMQ.sendToQueue(
    config.queues.paymentsProcess,
    retryData,
    {
      headers: {
        'x-retry-count': newRetryCount,
      },
    }
  );
}

/**
 * Handles dead letter messages (final failure)
 */
async function handleDeadLetter(deadData, msg) {
  logger.error('Payment in dead letter queue', {
    orderId: deadData.orderId,
    reason: msg.properties.headers && msg.properties.headers['x-first-death-reason'],
  });

  // Store for manual intervention
  failedPayments.set(deadData.orderId, {
    ...deadData,
    deadLetteredAt: new Date().toISOString(),
    reason: 'Max retries exceeded or permanent failure',
  });

  // In production: Send alert to operations team
  logger.warn('Manual intervention required', {
    orderId: deadData.orderId,
    failedPaymentsCount: failedPayments.size,
  });
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'payment-service',
    status: 'healthy',
    rabbitmq: rabbitMQ.isHealthy() ? 'connected' : 'disconnected',
    paymentsProcessed: payments.size,
    failedPayments: failedPayments.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get payment status endpoint
 */
app.get('/payments/:orderId', (req, res) => {
  const payment = payments.get(req.params.orderId);

  if (payment) {
    return res.json({
      success: true,
      data: payment,
    });
  }

  const failed = failedPayments.get(req.params.orderId);
  if (failed) {
    return res.json({
      success: false,
      data: failed,
      message: 'Payment failed',
    });
  }

  res.status(404).json({
    success: false,
    error: 'Payment not found',
  });
});

/**
 * Get all payments endpoint
 */
app.get('/payments', (req, res) => {
  res.json({
    success: true,
    data: {
      successful: Array.from(payments.values()),
      failed: Array.from(failedPayments.values()),
    },
  });
});

/**
 * Retry failed payment manually
 */
app.post('/payments/:orderId/retry', async (req, res) => {
  const failed = failedPayments.get(req.params.orderId);

  if (!failed) {
    return res.status(404).json({
      success: false,
      error: 'Failed payment not found',
    });
  }

  logger.info('Manual retry requested', {
    orderId: req.params.orderId,
  });

  // Re-publish with reset retry count
  await rabbitMQ.sendToQueue(
    config.queues.paymentsProcess,
    {
      orderId: failed.orderId,
      userId: failed.userId,
      amount: failed.amount,
      method: failed.method,
    },
    {
      headers: {
        'x-retry-count': 0,
      },
    }
  );

  // Remove from failed payments
  failedPayments.delete(req.params.orderId);

  res.json({
    success: true,
    message: 'Payment retry initiated',
  });
});

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully');
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

    // Consume payment processing messages
    await rabbitMQ.consume(config.queues.paymentsProcess, async (message, msg) => {
      await processPayment(message, msg);
    });

    logger.info('Started consuming payment requests', {
      queue: config.queues.paymentsProcess,
    });

    // Consume retry queue messages (after TTL expiry)
    // Note: These messages are automatically republished to payment queue
    // We just need to handle them if needed
    await rabbitMQ.consume(config.queues.paymentsRetry, async (message, msg) => {
      // Messages in this queue will automatically go back to payment queue after TTL
      // This consumer is optional - mainly for monitoring
      logger.info('Message in retry queue', {
        orderId: message.orderId,
        ttl: '30 seconds',
      });
    });

    logger.info('Started monitoring retry queue', {
      queue: config.queues.paymentsRetry,
    });

    // Consume dead letter queue
    await rabbitMQ.consume(config.queues.paymentsDead, async (message, msg) => {
      await handleDeadLetter(message, msg);
    });

    logger.info('Started consuming dead letter queue', {
      queue: config.queues.paymentsDead,
    });

    // Start HTTP server
    const port = config.services.payment.port;
    app.listen(port, () => {
      logServiceStart(logger, 'Payment Service', port);
    });
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
