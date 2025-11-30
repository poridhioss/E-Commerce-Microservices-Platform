/**
 * Notification Service
 * Sends notifications based on order events from Fanout Exchange
 * Demonstrates: Fanout Exchange (consumer), Email/SMS notifications
 */

const express = require('express');
const RabbitMQClient = require('../../shared/rabbitmq-client');
const { createLogger, logServiceStart, logError } = require('../../shared/logger');
const config = require('../../shared/config');

// Initialize
const app = express();
const logger = createLogger('notification-service');
const rabbitMQ = new RabbitMQClient('notification-service');

// In-memory notification storage (use database in production)
const notifications = [];

// Middleware
app.use(express.json());

/**
 * Email templates
 */
const emailTemplates = {
  'order.created': (data) => ({
    to: `user_${data.userId}@example.com`,
    subject: `Order Confirmation - ${data.orderId}`,
    body: `Your order ${data.orderId} has been received and is being processed. Total: $${data.total}`,
  }),
  'payment.success': (data) => ({
    to: `user_${data.userId || 'unknown'}@example.com`,
    subject: `Payment Successful - ${data.orderId}`,
    body: `Your payment of $${data.amount} for order ${data.orderId} was successful. Transaction ID: ${data.transactionId}`,
  }),
  'payment.failed': (data) => ({
    to: `user_${data.userId || 'unknown'}@example.com`,
    subject: `Payment Failed - ${data.orderId}`,
    body: `Your payment for order ${data.orderId} failed. Error: ${data.error}. Please try again.`,
  }),
  'shipment.created': (data) => ({
    to: `user_${data.userId || 'unknown'}@example.com`,
    subject: `Order Shipped - ${data.orderId}`,
    body: `Your order ${data.orderId} has been shipped. Tracking number: ${data.trackingNumber}`,
  }),
};

/**
 * Simulates sending email
 */
async function sendEmail(email) {
  // In production, integrate with SendGrid, AWS SES, etc.
  logger.info('Sending email', {
    to: email.to,
    subject: email.subject,
  });

  // Simulate email sending delay
  await new Promise(resolve => setTimeout(resolve, 500));

  return {
    messageId: `EMAIL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: 'sent',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Simulates sending SMS
 */
async function sendSMS(phone, message) {
  // In production, integrate with Twilio, AWS SNS, etc.
  logger.info('Sending SMS', {
    to: phone,
    message: message.substring(0, 50) + '...',
  });

  // Simulate SMS sending delay
  await new Promise(resolve => setTimeout(resolve, 300));

  return {
    messageId: `SMS-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: 'sent',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Processes notification event
 */
async function processNotification(event) {
  try {
    logger.info('Processing notification event', {
      eventType: event.eventType,
      orderId: event.orderId,
    });

    const template = emailTemplates[event.eventType];
    if (!template) {
      logger.warn('No template found for event type', {
        eventType: event.eventType,
      });
      return;
    }

    // Generate email from template
    const email = template(event);

    // Send email
    const emailResult = await sendEmail(email);

    // For high-value orders, also send SMS
    if (event.total && event.total > 1000) {
      const smsResult = await sendSMS(
        '+1234567890', // In production, get from user profile
        email.body
      );

      logger.info('SMS notification sent', {
        orderId: event.orderId,
        messageId: smsResult.messageId,
      });
    }

    // Store notification record
    const notification = {
      id: `NOTIF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      eventType: event.eventType,
      orderId: event.orderId,
      email: email,
      emailMessageId: emailResult.messageId,
      status: 'sent',
      sentAt: new Date().toISOString(),
    };

    notifications.push(notification);

    logger.info('Notification sent successfully', {
      orderId: event.orderId,
      eventType: event.eventType,
      messageId: emailResult.messageId,
    });
  } catch (error) {
    logError(logger, error, {
      eventType: event.eventType,
      orderId: event.orderId,
    });

    // Store failed notification
    notifications.push({
      id: `NOTIF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      eventType: event.eventType,
      orderId: event.orderId,
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString(),
    });
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'notification-service',
    status: 'healthy',
    rabbitmq: rabbitMQ.isHealthy() ? 'connected' : 'disconnected',
    notificationsSent: notifications.filter(n => n.status === 'sent').length,
    notificationsFailed: notifications.filter(n => n.status === 'failed').length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get all notifications endpoint
 */
app.get('/notifications', (req, res) => {
  res.json({
    success: true,
    data: notifications.slice(-50), // Last 50 notifications
  });
});

/**
 * Get notifications by order ID
 */
app.get('/notifications/order/:orderId', (req, res) => {
  const orderNotifications = notifications.filter(
    n => n.orderId === req.params.orderId
  );

  res.json({
    success: true,
    data: orderNotifications,
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

    // Consume from notification queue (Fanout Exchange)
    await rabbitMQ.consume(config.queues.ordersNotification, async (message) => {
      await processNotification(message);
    });

    logger.info('Started consuming notifications', {
      queue: config.queues.ordersNotification,
      exchange: config.exchanges.ordersFanout,
    });

    // Start HTTP server
    const port = config.services.notification.port;
    app.listen(port, () => {
      logServiceStart(logger, 'Notification Service', port);
    });
  } catch (error) {
    logError(logger, error, { event: 'startup_failed' });
    process.exit(1);
  }
}

start();
