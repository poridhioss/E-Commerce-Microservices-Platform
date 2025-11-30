/**
 * Shared Configuration Module
 * Loads and validates environment variables for microservices
 */

require('dotenv').config();

const config = {
  // RabbitMQ Configuration
  rabbitmq: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
    username: process.env.RABBITMQ_USER || 'admin',
    password: process.env.RABBITMQ_PASS || 'admin123',
    vhost: process.env.RABBITMQ_VHOST || '/',
    heartbeat: 60,
    reconnectInterval: 5000,
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  // Service Configuration
  services: {
    apiGateway: {
      port: parseInt(process.env.API_GATEWAY_PORT || '3000', 10),
    },
    order: {
      port: parseInt(process.env.ORDER_SERVICE_PORT || '3001', 10),
    },
    inventory: {
      port: parseInt(process.env.INVENTORY_SERVICE_PORT || '3002', 10),
    },
    payment: {
      port: parseInt(process.env.PAYMENT_SERVICE_PORT || '3003', 10),
    },
    notification: {
      port: parseInt(process.env.NOTIFICATION_SERVICE_PORT || '3004', 10),
    },
    analytics: {
      port: parseInt(process.env.ANALYTICS_SERVICE_PORT || '3005', 10),
    },
    shipping: {
      port: parseInt(process.env.SHIPPING_SERVICE_PORT || '3006', 10),
    },
    audit: {
      port: parseInt(process.env.AUDIT_SERVICE_PORT || '3007', 10),
    },
  },

  // Environment
  env: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Retry Configuration
  retry: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10),
    delayMs: parseInt(process.env.RETRY_DELAY_MS || '5000', 10),
  },

  // Message Configuration
  message: {
    ttl: parseInt(process.env.MESSAGE_TTL_MS || '300000', 10), // 5 minutes
  },

  // RabbitMQ Exchanges
  exchanges: {
    ordersDirect: 'orders.direct',
    ordersFanout: 'orders.fanout',
    ordersTopic: 'orders.topic',
    ordersHeaders: 'orders.headers',
    paymentsDLX: 'payments.dlx',
    inventoryTopic: 'inventory.topic',
  },

  // RabbitMQ Queues
  queues: {
    ordersHigh: 'orders.high',
    ordersNormal: 'orders.normal',
    ordersAnalytics: 'orders.analytics',
    ordersAudit: 'orders.audit',
    ordersNotification: 'orders.notification',
    ordersUS: 'orders.us',
    ordersEU: 'orders.eu',
    ordersPremium: 'orders.premium',
    ordersMobile: 'orders.mobile',
    inventoryLowStock: 'inventory.lowstock',
    inventoryCheck: 'inventory.check',
    paymentsProcess: 'payments.process',
    paymentsRetry: 'payments.retry',
    paymentsDead: 'payments.dead',
    shippingCreate: 'shipping.create',
  },

  // Routing Keys
  routingKeys: {
    orderHigh: 'order.high',
    orderNormal: 'order.normal',
    paymentProcess: 'payment.process',
    paymentRetry: 'payment.retry',
    paymentFailed: 'payment.failed',
  },
};

/**
 * Validates required configuration
 */
function validateConfig() {
  const required = [
    'RABBITMQ_HOST',
    'JWT_SECRET',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0 && config.isProduction) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return true;
}

// Validate on load in production
if (config.isProduction) {
  validateConfig();
}

module.exports = config;
