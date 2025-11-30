/**
 * Shipping Service
 * Handles shipment creation based on region using Topic Exchange
 * Demonstrates: Topic Exchange (consumer), Region-based routing
 */

const express = require('express');
const RabbitMQClient = require('../../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../../shared/logger');
const config = require('../../shared/config');

// Initialize
const app = express();
const logger = createLogger('shipping-service');
const rabbitMQ = new RabbitMQClient('shipping-service');

// In-memory shipment storage (use database in production)
const shipments = new Map();

// Middleware
app.use(express.json());

// Carrier configurations by region
const carriers = {
  us: { name: 'USPS', transitDays: 3 },
  eu: { name: 'DHL', transitDays: 5 },
  asia: { name: 'FedEx', transitDays: 7 },
  default: { name: 'UPS', transitDays: 5 },
};

/**
 * Generates tracking number
 */
function generateTrackingNumber(region) {
  const prefix = region ? region.toUpperCase() : 'GLO';
  const random = Math.random().toString(36).substring(2, 15).toUpperCase();
  return `${prefix}-${Date.now()}-${random}`;
}

/**
 * Creates a shipment
 */
async function createShipment(shipmentData) {
  try {
    logger.info('Creating shipment', {
      orderId: shipmentData.orderId,
    });

    // Determine carrier based on region (from order data or default)
    const region = shipmentData.region || 'default';
    const carrier = carriers[region] || carriers.default;

    // Calculate estimated delivery
    const estimatedDelivery = new Date();
    estimatedDelivery.setDate(estimatedDelivery.getDate() + carrier.transitDays);

    // Create shipment record
    const shipment = {
      shipmentId: `SHIP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      orderId: shipmentData.orderId,
      trackingNumber: generateTrackingNumber(region),
      carrier: carrier.name,
      status: 'created',
      shippingAddress: shipmentData.shippingAddress,
      region: region,
      estimatedDelivery: estimatedDelivery.toISOString(),
      createdAt: new Date().toISOString(),
      updates: [],
    };

    // Store shipment
    shipments.set(shipment.shipmentId, shipment);

    logger.info('Shipment created', {
      shipmentId: shipment.shipmentId,
      orderId: shipment.orderId,
      trackingNumber: shipment.trackingNumber,
      carrier: carrier.name,
    });

    // Publish shipment created event
    await rabbitMQ.publish(
      config.exchanges.ordersFanout,
      '',
      {
        eventType: 'shipment.created',
        orderId: shipment.orderId,
        shipmentId: shipment.shipmentId,
        trackingNumber: shipment.trackingNumber,
        carrier: carrier.name,
        estimatedDelivery: shipment.estimatedDelivery,
        timestamp: new Date().toISOString(),
      }
    );

    // Simulate shipping progress
    setTimeout(() => updateShipmentStatus(shipment.shipmentId, 'picked_up'), 5000);
  } catch (error) {
    logError(logger, error, {
      orderId: shipmentData.orderId,
    });
  }
}

/**
 * Updates shipment status
 */
async function updateShipmentStatus(shipmentId, status) {
  const shipment = shipments.get(shipmentId);

  if (!shipment) {
    logger.warn('Shipment not found for status update', { shipmentId });
    return;
  }

  shipment.status = status;
  shipment.updates.push({
    status,
    timestamp: new Date().toISOString(),
  });

  shipments.set(shipmentId, shipment);

  logger.info('Shipment status updated', {
    shipmentId,
    orderId: shipment.orderId,
    status,
  });

  // Publish status update event
  await rabbitMQ.publish(
    config.exchanges.ordersFanout,
    '',
    {
      eventType: 'shipment.updated',
      orderId: shipment.orderId,
      shipmentId: shipment.shipmentId,
      status,
      timestamp: new Date().toISOString(),
    }
  );

  // Continue simulation
  const statusFlow = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
  const currentIndex = statusFlow.indexOf(status);

  if (currentIndex < statusFlow.length - 1) {
    setTimeout(
      () => updateShipmentStatus(shipmentId, statusFlow[currentIndex + 1]),
      10000
    );
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'shipping-service',
    status: 'healthy',
    rabbitmq: rabbitMQ.isHealthy() ? 'connected' : 'disconnected',
    shipmentsCreated: shipments.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get all shipments endpoint
 */
app.get('/shipments', (req, res) => {
  res.json({
    success: true,
    data: Array.from(shipments.values()),
  });
});

/**
 * Get shipment by ID
 */
app.get('/shipments/:shipmentId', (req, res) => {
  const shipment = shipments.get(req.params.shipmentId);

  if (!shipment) {
    return res.status(404).json({
      success: false,
      error: 'Shipment not found',
    });
  }

  res.json({
    success: true,
    data: shipment,
  });
});

/**
 * Track shipment by tracking number
 */
app.get('/track/:trackingNumber', (req, res) => {
  const shipment = Array.from(shipments.values()).find(
    s => s.trackingNumber === req.params.trackingNumber
  );

  if (!shipment) {
    return res.status(404).json({
      success: false,
      error: 'Tracking number not found',
    });
  }

  res.json({
    success: true,
    data: {
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      carrier: shipment.carrier,
      estimatedDelivery: shipment.estimatedDelivery,
      updates: shipment.updates,
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

    // Consume from shipping queue (Topic Exchange)
    // Routing key: shipping.create or shipping.#
    await rabbitMQ.consume(config.queues.shippingCreate, async (message) => {
      await createShipment(message);
    });

    logger.info('Started consuming shipping requests', {
      queue: config.queues.shippingCreate,
      exchange: config.exchanges.ordersTopic,
    });

    // Start HTTP server
    const port = config.services.shipping.port;
    app.listen(port, () => {
      logServiceStart(logger, 'Shipping Service', port);
    });
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
