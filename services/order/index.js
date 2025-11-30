/**
 * Order Service
 * Processes orders from Direct Exchange and publishes events to Fanout Exchange
 * Demonstrates: Direct Exchange (consumer), Fanout Exchange (publisher)
 */

const express = require('express');
const RabbitMQClient = require('../../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../../shared/logger');
const config = require('../../shared/config');

// Initialize
const app = express();
const logger = createLogger('order-service');
const rabbitMQ = new RabbitMQClient('order-service');

// In-memory order storage (use database in production)
const orders = new Map();

// Middleware
app.use(express.json());

/**
 * Processes an order
 */
async function processOrder(orderData) {
  try {
    logger.info('Processing order', {
      orderId: orderData.orderId,
      priority: orderData.priority,
      total: orderData.total,
    });

    // Update order status
    orderData.status = 'processing';
    orderData.processedAt = new Date().toISOString();

    // Store order
    orders.set(orderData.orderId, orderData);

    // Simulate order validation and processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check inventory for each item
    for (const item of orderData.items) {
      const inventoryCheck = {
        orderId: orderData.orderId,
        productId: item.productId,
        quantity: item.quantity,
        timestamp: new Date().toISOString(),
      };

      // Publish inventory check to Topic Exchange
      await rabbitMQ.publish(
        config.exchanges.inventoryTopic,
        `inventory.${item.productId}.check`,
        inventoryCheck
      );

      logger.info('Inventory check requested', {
        orderId: orderData.orderId,
        productId: item.productId,
      });
    }

    // Update order status
    orderData.status = 'inventory_checked';
    orders.set(orderData.orderId, orderData);

    // Publish order event to Fanout Exchange
    // This will be consumed by Analytics, Audit, and Notification services
    const orderEvent = {
      eventType: 'order.created',
      orderId: orderData.orderId,
      userId: orderData.userId,
      total: orderData.total,
      priority: orderData.priority,
      region: orderData.region,
      itemCount: orderData.items.length,
      timestamp: new Date().toISOString(),
    };

    await rabbitMQ.publish(
      config.exchanges.ordersFanout,
      '', // Fanout doesn't use routing keys
      orderEvent
    );

    logger.info('Order event broadcasted', {
      orderId: orderData.orderId,
      exchange: config.exchanges.ordersFanout,
      eventType: 'order.created',
    });

    // Send to payment processing
    const paymentRequest = {
      orderId: orderData.orderId,
      userId: orderData.userId,
      amount: orderData.total,
      method: 'credit_card', // In production, get from order data
      timestamp: new Date().toISOString(),
    };

    await rabbitMQ.sendToQueue(
      config.queues.paymentsProcess,
      paymentRequest
    );

    logger.info('Payment request sent', {
      orderId: orderData.orderId,
      amount: orderData.total,
    });

    // Update order status
    orderData.status = 'payment_pending';
    orders.set(orderData.orderId, orderData);

  } catch (error) {
    logError(logger, error, {
      orderId: orderData.orderId,
      stage: 'order_processing',
    });

    // Update order status to failed
    orderData.status = 'failed';
    orderData.error = error.message;
    orders.set(orderData.orderId, orderData);
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'order-service',
    status: 'healthy',
    rabbitmq: rabbitMQ.isHealthy() ? 'connected' : 'disconnected',
    ordersProcessed: orders.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get order status endpoint
 */
app.get('/orders/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);

  if (!order) {
    return res.status(404).json({
      success: false,
      error: 'Order not found',
    });
  }

  res.json({
    success: true,
    data: order,
  });
});

/**
 * Get all orders endpoint (for debugging)
 */
app.get('/orders', (req, res) => {
  res.json({
    success: true,
    data: Array.from(orders.values()),
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

    // Start consuming from high priority queue
    await rabbitMQ.consume(config.queues.ordersHigh, async (message) => {
      logger.info('Received high priority order', {
        orderId: message.orderId,
      });
      await processOrder(message);
    });

    logger.info('Started consuming from high priority queue', {
      queue: config.queues.ordersHigh,
    });

    // Start consuming from normal priority queue
    await rabbitMQ.consume(config.queues.ordersNormal, async (message) => {
      logger.info('Received normal priority order', {
        orderId: message.orderId,
      });
      await processOrder(message);
    });

    logger.info('Started consuming from normal priority queue', {
      queue: config.queues.ordersNormal,
    });

    // Start HTTP server
    const port = config.services.order.port;
    app.listen(port, () => {
      logServiceStart(logger, 'Order Service', port);
    });
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
