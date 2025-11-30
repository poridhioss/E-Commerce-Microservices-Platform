/**
 * Analytics Service
 * Aggregates and analyzes order events from Fanout Exchange
 * Demonstrates: Event aggregation, metrics collection, time-series data
 */

const express = require('express');
const RabbitMQClient = require('../../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../../shared/logger');
const config = require('../../shared/config');

// Initialize
const app = express();
const logger = createLogger('analytics-service');
const rabbitMQ = new RabbitMQClient('analytics-service');

// Analytics data storage (use time-series database in production like InfluxDB)
const metrics = {
  orders: {
    total: 0,
    byPriority: { high: 0, normal: 0 },
    byRegion: {},
    totalRevenue: 0,
    averageOrderValue: 0,
  },
  payments: {
    successful: 0,
    failed: 0,
    totalProcessed: 0,
    successRate: 0,
  },
  events: [],
  hourlyStats: {},
};

// Middleware
app.use(express.json());

/**
 * Updates hourly statistics
 */
function updateHourlyStats(eventType) {
  const hour = new Date().toISOString().substring(0, 13); // YYYY-MM-DDTHH

  if (!metrics.hourlyStats[hour]) {
    metrics.hourlyStats[hour] = {
      orders: 0,
      payments: 0,
      events: 0,
    };
  }

  metrics.hourlyStats[hour].events++;

  if (eventType === 'order.created') {
    metrics.hourlyStats[hour].orders++;
  } else if (eventType.startsWith('payment.')) {
    metrics.hourlyStats[hour].payments++;
  }
}

/**
 * Processes analytics event
 */
async function processEvent(event) {
  try {
    logger.info('Processing analytics event', {
      eventType: event.eventType,
      orderId: event.orderId,
    });

    // Store event
    metrics.events.push({
      ...event,
      processedAt: new Date().toISOString(),
    });

    // Keep only last 1000 events in memory
    if (metrics.events.length > 1000) {
      metrics.events = metrics.events.slice(-1000);
    }

    // Update metrics based on event type
    switch (event.eventType) {
      case 'order.created':
        metrics.orders.total++;

        // By priority
        if (event.priority) {
          metrics.orders.byPriority[event.priority] =
            (metrics.orders.byPriority[event.priority] || 0) + 1;
        }

        // By region
        if (event.region) {
          metrics.orders.byRegion[event.region] =
            (metrics.orders.byRegion[event.region] || 0) + 1;
        }

        // Revenue
        if (event.total) {
          metrics.orders.totalRevenue += event.total;
          metrics.orders.averageOrderValue =
            metrics.orders.totalRevenue / metrics.orders.total;
        }

        logger.info('Order metrics updated', {
          totalOrders: metrics.orders.total,
          totalRevenue: metrics.orders.totalRevenue,
        });
        break;

      case 'payment.success':
        metrics.payments.successful++;
        metrics.payments.totalProcessed++;
        metrics.payments.successRate =
          (metrics.payments.successful / metrics.payments.totalProcessed) * 100;

        logger.info('Payment success metrics updated', {
          successful: metrics.payments.successful,
          successRate: metrics.payments.successRate.toFixed(2) + '%',
        });
        break;

      case 'payment.failed':
        metrics.payments.failed++;
        metrics.payments.totalProcessed++;
        metrics.payments.successRate =
          (metrics.payments.successful / metrics.payments.totalProcessed) * 100;

        logger.info('Payment failure metrics updated', {
          failed: metrics.payments.failed,
          successRate: metrics.payments.successRate.toFixed(2) + '%',
        });
        break;
    }

    // Update hourly stats
    updateHourlyStats(event.eventType);
  } catch (error) {
    logError(logger, error, {
      eventType: event.eventType,
      orderId: event.orderId,
    });
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'analytics-service',
    status: 'healthy',
    rabbitmq: rabbitMQ.isHealthy() ? 'connected' : 'disconnected',
    eventsProcessed: metrics.events.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get metrics endpoint
 */
app.get('/metrics', (req, res) => {
  res.json({
    success: true,
    data: {
      orders: metrics.orders,
      payments: metrics.payments,
      lastUpdated: new Date().toISOString(),
    },
  });
});

/**
 * Get hourly statistics
 */
app.get('/metrics/hourly', (req, res) => {
  res.json({
    success: true,
    data: metrics.hourlyStats,
  });
});

/**
 * Get recent events
 */
app.get('/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const eventType = req.query.type;

  let events = metrics.events;

  if (eventType) {
    events = events.filter(e => e.eventType === eventType);
  }

  res.json({
    success: true,
    data: events.slice(-limit),
  });
});

/**
 * Get dashboard data
 */
app.get('/dashboard', (req, res) => {
  res.json({
    success: true,
    data: {
      summary: {
        totalOrders: metrics.orders.total,
        totalRevenue: metrics.orders.totalRevenue,
        averageOrderValue: metrics.orders.averageOrderValue,
        paymentSuccessRate: metrics.payments.successRate,
      },
      ordersByPriority: metrics.orders.byPriority,
      ordersByRegion: metrics.orders.byRegion,
      paymentStats: {
        successful: metrics.payments.successful,
        failed: metrics.payments.failed,
        total: metrics.payments.totalProcessed,
      },
      recentEvents: metrics.events.slice(-10),
    },
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

    // Consume from analytics queue (Fanout Exchange)
    await rabbitMQ.consume(config.queues.ordersAnalytics, async (message) => {
      await processEvent(message);
    });

    logger.info('Started consuming analytics events', {
      queue: config.queues.ordersAnalytics,
      exchange: config.exchanges.ordersFanout,
    });

    // Start HTTP server
    const port = config.services.analytics.port;
    app.listen(port, () => {
      logServiceStart(logger, 'Analytics Service', port);
    });
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
