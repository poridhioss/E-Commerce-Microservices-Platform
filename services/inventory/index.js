/**
 * Inventory Service
 * Manages stock levels and publishes low-stock alerts
 * Demonstrates: Topic Exchange (consumer and publisher)
 */

const express = require('express');
const RabbitMQClient = require('../../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../../shared/logger');
const config = require('../../shared/config');

// Initialize
const app = express();
const logger = createLogger('inventory-service');
const rabbitMQ = new RabbitMQClient('inventory-service');

// In-memory inventory storage (use database in production)
const inventory = new Map([
  ['PROD001', { productId: 'PROD001', name: 'Laptop', category: 'electronics', stock: 50, lowStockThreshold: 10 }],
  ['PROD002', { productId: 'PROD002', name: 'Mouse', category: 'electronics', stock: 5, lowStockThreshold: 10 }],
  ['PROD003', { productId: 'PROD003', name: 'Keyboard', category: 'electronics', stock: 30, lowStockThreshold: 10 }],
  ['PROD004', { productId: 'PROD004', name: 'T-Shirt', category: 'clothing', stock: 100, lowStockThreshold: 20 }],
  ['PROD005', { productId: 'PROD005', name: 'Jeans', category: 'clothing', stock: 15, lowStockThreshold: 20 }],
]);

// Middleware
app.use(express.json());

/**
 * Checks inventory for a product
 */
async function checkInventory(checkData) {
  try {
    logger.info('Checking inventory', {
      orderId: checkData.orderId,
      productId: checkData.productId,
      quantity: checkData.quantity,
    });

    const product = inventory.get(checkData.productId);

    if (!product) {
      logger.warn('Product not found', {
        productId: checkData.productId,
      });

      // Publish inventory not found event
      await rabbitMQ.publish(
        config.exchanges.inventoryTopic,
        `inventory.${checkData.productId}.notfound`,
        {
          orderId: checkData.orderId,
          productId: checkData.productId,
          available: false,
          reason: 'Product not found',
          timestamp: new Date().toISOString(),
        }
      );

      return;
    }

    // Check if sufficient stock
    const available = product.stock >= checkData.quantity;

    if (available) {
      // Reserve inventory
      product.stock -= checkData.quantity;
      product.lastUpdated = new Date().toISOString();
      inventory.set(checkData.productId, product);

      logger.info('Inventory reserved', {
        orderId: checkData.orderId,
        productId: checkData.productId,
        quantity: checkData.quantity,
        remainingStock: product.stock,
      });

      // Publish inventory reserved event
      await rabbitMQ.publish(
        config.exchanges.inventoryTopic,
        `inventory.${product.category}.reserved`,
        {
          orderId: checkData.orderId,
          productId: checkData.productId,
          quantity: checkData.quantity,
          remainingStock: product.stock,
          timestamp: new Date().toISOString(),
        }
      );

      // Check if low stock
      if (product.stock <= product.lowStockThreshold) {
        await publishLowStockAlert(product);
      }
    } else {
      logger.warn('Insufficient inventory', {
        orderId: checkData.orderId,
        productId: checkData.productId,
        requested: checkData.quantity,
        available: product.stock,
      });

      // Publish insufficient inventory event
      await rabbitMQ.publish(
        config.exchanges.inventoryTopic,
        `inventory.${product.category}.insufficient`,
        {
          orderId: checkData.orderId,
          productId: checkData.productId,
          requested: checkData.quantity,
          available: product.stock,
          timestamp: new Date().toISOString(),
        }
      );
    }
  } catch (error) {
    logError(logger, error, {
      orderId: checkData.orderId,
      productId: checkData.productId,
    });
  }
}

/**
 * Publishes low stock alert
 */
async function publishLowStockAlert(product) {
  const alert = {
    productId: product.productId,
    name: product.name,
    category: product.category,
    currentStock: product.stock,
    threshold: product.lowStockThreshold,
    severity: product.stock === 0 ? 'critical' : 'warning',
    timestamp: new Date().toISOString(),
  };

  // Publish to topic exchange with low stock routing key
  await rabbitMQ.publish(
    config.exchanges.inventoryTopic,
    `inventory.${product.category}.low`,
    alert
  );

  logger.warn('Low stock alert published', {
    productId: product.productId,
    currentStock: product.stock,
    threshold: product.lowStockThreshold,
  });
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'inventory-service',
    status: 'healthy',
    rabbitmq: rabbitMQ.isHealthy() ? 'connected' : 'disconnected',
    productsManaged: inventory.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get inventory endpoint
 */
app.get('/inventory', (req, res) => {
  const inventoryList = Array.from(inventory.values());

  res.json({
    success: true,
    data: inventoryList,
  });
});

/**
 * Get product inventory endpoint
 */
app.get('/inventory/:productId', (req, res) => {
  const product = inventory.get(req.params.productId);

  if (!product) {
    return res.status(404).json({
      success: false,
      error: 'Product not found',
    });
  }

  res.json({
    success: true,
    data: product,
  });
});

/**
 * Update stock endpoint (for testing)
 */
app.post('/inventory/:productId/restock', express.json(), async (req, res) => {
  const product = inventory.get(req.params.productId);

  if (!product) {
    return res.status(404).json({
      success: false,
      error: 'Product not found',
    });
  }

  const { quantity } = req.body;
  if (!quantity || quantity <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid quantity',
    });
  }

  product.stock += quantity;
  product.lastUpdated = new Date().toISOString();
  inventory.set(req.params.productId, product);

  logger.info('Inventory restocked', {
    productId: product.productId,
    quantity,
    newStock: product.stock,
  });

  // Publish restock event
  await rabbitMQ.publish(
    config.exchanges.inventoryTopic,
    `inventory.${product.category}.restocked`,
    {
      productId: product.productId,
      quantity,
      newStock: product.stock,
      timestamp: new Date().toISOString(),
    }
  );

  res.json({
    success: true,
    data: product,
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

    // Consume inventory check messages (Topic Exchange)
    // Listens to: inventory.*.check
    await rabbitMQ.consume(config.queues.inventoryCheck, async (message) => {
      await checkInventory(message);
    });

    logger.info('Started consuming inventory checks', {
      queue: config.queues.inventoryCheck,
    });

    // Start HTTP server
    const port = config.services.inventory.port;
    app.listen(port, () => {
      logServiceStart(logger, 'Inventory Service', port);
    });

    // Periodic low-stock check (every 5 minutes)
    setInterval(async () => {
      logger.info('Running periodic low-stock check');

      for (const product of inventory.values()) {
        if (product.stock <= product.lowStockThreshold) {
          await publishLowStockAlert(product);
        }
      }
    }, 5 * 60 * 1000);
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
