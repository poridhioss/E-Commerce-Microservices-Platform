/**
 * Shared Logger Module
 * Winston-based structured logging for microservices
 */

const winston = require('winston');
const config = require('./config');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    let msg = `${timestamp} [${service || 'app'}] ${level}: ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }

    return msg;
  })
);

/**
 * Creates a logger instance for a specific service
 * @param {string} serviceName - Name of the service
 * @returns {winston.Logger} Configured logger instance
 */
function createLogger(serviceName) {
  const logger = winston.createLogger({
    level: config.logging.level,
    format: logFormat,
    defaultMeta: { service: serviceName },
    transports: [
      // Console transport
      new winston.transports.Console({
        format: config.isDevelopment ? consoleFormat : logFormat,
      }),
    ],
  });

  // Add file transport in production
  if (config.isProduction) {
    logger.add(
      new winston.transports.File({
        filename: `logs/${serviceName}-error.log`,
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    );

    logger.add(
      new winston.transports.File({
        filename: `logs/${serviceName}-combined.log`,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    );
  }

  return logger;
}

/**
 * Logs RabbitMQ message consumption
 */
function logMessageReceived(logger, queue, message) {
  logger.info('Message received', {
    queue,
    messageId: message.properties?.messageId,
    correlationId: message.properties?.correlationId,
    timestamp: message.properties?.timestamp,
  });
}

/**
 * Logs RabbitMQ message publishing
 */
function logMessagePublished(logger, exchange, routingKey, messageId) {
  logger.info('Message published', {
    exchange,
    routingKey,
    messageId,
  });
}

/**
 * Logs errors with stack trace
 */
function logError(logger, error, context = {}) {
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    ...context,
  });
}

/**
 * Logs service startup
 */
function logServiceStart(logger, serviceName, port) {
  logger.info(`${serviceName} started`, {
    port,
    environment: config.env,
    nodeVersion: process.version,
  });
}

/**
 * Logs RabbitMQ connection events
 */
function logRabbitMQConnection(logger, event, details = {}) {
  const logLevel = event === 'error' ? 'error' : 'info';
  logger[logLevel](`RabbitMQ ${event}`, details);
}

module.exports = {
  createLogger,
  logMessageReceived,
  logMessagePublished,
  logError,
  logServiceStart,
  logRabbitMQConnection,
};
