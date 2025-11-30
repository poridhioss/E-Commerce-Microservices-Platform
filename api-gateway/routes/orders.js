/**
 * Order Routes
 * Handles order creation and publishes to RabbitMQ
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const config = require('../../shared/config');

const router = express.Router();

/**
 * POST /api/orders
 * Creates a new order and publishes to RabbitMQ
 * Demonstrates: Direct Exchange, Topic Exchange, Headers Exchange
 */
router.post(
  '/',
  authenticateToken,
  [
    body('items').isArray({ min: 1 }),
    body('items.*.productId').notEmpty(),
    body('items.*.quantity').isInt({ min: 1 }),
    body('items.*.price').isFloat({ min: 0 }),
    body('priority').optional().isIn(['high', 'normal']).default('normal'),
    body('shippingAddress').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const rabbitMQ = req.app.get('rabbitMQ');
    const logger = req.app.get('logger');

    try {
      const { items, priority = 'normal', shippingAddress } = req.body;
      const user = req.user;

      // Calculate total
      const total = items.reduce((sum, item) => {
        return sum + item.price * item.quantity;
      }, 0);

      // Create order object
      const order = {
        orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: user.userId,
        items,
        total,
        priority,
        shippingAddress,
        region: user.region,
        userTier: user.tier,
        device: user.device,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      // 1. Publish to Direct Exchange (priority-based routing)
      const routingKey = priority === 'high'
        ? config.routingKeys.orderHigh
        : config.routingKeys.orderNormal;

      await rabbitMQ.publish(
        config.exchanges.ordersDirect,
        routingKey,
        order,
        { priority: priority === 'high' ? 10 : 5 }
      );

      logger.info('Order published to direct exchange', {
        orderId: order.orderId,
        exchange: config.exchanges.ordersDirect,
        routingKey,
      });

      // 2. Publish to Topic Exchange (region-based routing)
      const topicRoutingKey = `orders.${user.region}.${priority}`;
      await rabbitMQ.publish(
        config.exchanges.ordersTopic,
        topicRoutingKey,
        order
      );

      logger.info('Order published to topic exchange', {
        orderId: order.orderId,
        exchange: config.exchanges.ordersTopic,
        routingKey: topicRoutingKey,
      });

      // 3. Publish to Headers Exchange (metadata-based routing)
      await rabbitMQ.publishWithHeaders(
        config.exchanges.ordersHeaders,
        order,
        {
          user_tier: user.tier,
          device: user.device,
          priority: priority,
        }
      );

      logger.info('Order published to headers exchange', {
        orderId: order.orderId,
        exchange: config.exchanges.ordersHeaders,
        headers: { user_tier: user.tier, device: user.device },
      });

      res.status(201).json({
        success: true,
        data: {
          orderId: order.orderId,
          status: 'pending',
          total: order.total,
          message: 'Order created and queued for processing',
        },
      });
    } catch (error) {
      logger.error('Order creation failed', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create order',
      });
    }
  }
);

/**
 * GET /api/orders/:orderId
 * Retrieves order status (mock implementation)
 */
router.get('/:orderId', authenticateToken, (req, res) => {
  const { orderId } = req.params;

  // In production, query from database
  res.json({
    success: true,
    data: {
      orderId,
      status: 'processing',
      message: 'Order is being processed',
    },
  });
});

module.exports = router;
