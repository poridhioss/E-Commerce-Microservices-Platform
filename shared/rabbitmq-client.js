/**
 * Shared RabbitMQ Client Module
 * Provides connection management, publishing, and consuming capabilities
 * with automatic reconnection and error handling
 */

const amqp = require('amqplib');
const config = require('./config');
const { createLogger, logRabbitMQConnection, logError } = require('./logger');

class RabbitMQClient {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.logger = createLogger(`rabbitmq-${serviceName}`);
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.consumers = new Map();
  }

  /**
   * Establishes connection to RabbitMQ
   */
  async connect() {
    try {
      const amqpUrl = `amqp://${config.rabbitmq.username}:${config.rabbitmq.password}@${config.rabbitmq.host}:${config.rabbitmq.port}${config.rabbitmq.vhost}`;

      this.connection = await amqp.connect(amqpUrl, {
        heartbeat: config.rabbitmq.heartbeat,
      });

      this.connection.on('error', (err) => {
        logError(this.logger, err, { event: 'connection_error' });
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        logRabbitMQConnection(this.logger, 'connection_closed');
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.channel = await this.connection.createChannel();

      this.channel.on('error', (err) => {
        logError(this.logger, err, { event: 'channel_error' });
      });

      this.channel.on('close', () => {
        logRabbitMQConnection(this.logger, 'channel_closed');
      });

      // Set prefetch for fair dispatch
      await this.channel.prefetch(1);

      this.isConnected = true;
      logRabbitMQConnection(this.logger, 'connected', {
        host: config.rabbitmq.host,
        port: config.rabbitmq.port,
      });

      return true;
    } catch (error) {
      logError(this.logger, error, { event: 'connection_failed' });
      this.scheduleReconnect();
      return false;
    }
  }

  /**
   * Schedules automatic reconnection
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.logger.info('Scheduling reconnection', {
      delay: config.rabbitmq.reconnectInterval,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, config.rabbitmq.reconnectInterval);
  }

  /**
   * Asserts an exchange exists
   */
  async assertExchange(exchange, type, options = {}) {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const defaultOptions = {
      durable: true,
      autoDelete: false,
      ...options,
    };

    await this.channel.assertExchange(exchange, type, defaultOptions);
    this.logger.debug('Exchange asserted', { exchange, type });
  }

  /**
   * Asserts a queue exists
   */
  async assertQueue(queue, options = {}) {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const defaultOptions = {
      durable: true,
      autoDelete: false,
      ...options,
    };

    const result = await this.channel.assertQueue(queue, defaultOptions);
    this.logger.debug('Queue asserted', { queue, messageCount: result.messageCount });
    return result;
  }

  /**
   * Binds a queue to an exchange
   */
  async bindQueue(queue, exchange, routingKey = '', args = {}) {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    await this.channel.bindQueue(queue, exchange, routingKey, args);
    this.logger.debug('Queue bound', { queue, exchange, routingKey });
  }

  /**
   * Publishes a message to an exchange
   */
  async publish(exchange, routingKey, message, options = {}) {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const messageBuffer = Buffer.from(JSON.stringify(message));

    const defaultOptions = {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
      messageId: this.generateMessageId(),
      ...options,
    };

    const published = this.channel.publish(
      exchange,
      routingKey,
      messageBuffer,
      defaultOptions
    );

    if (!published) {
      this.logger.warn('Message not published (buffer full)', {
        exchange,
        routingKey,
      });
      // Wait for drain event
      await new Promise((resolve) => this.channel.once('drain', resolve));
    }

    this.logger.info('Message published', {
      exchange,
      routingKey,
      messageId: defaultOptions.messageId,
    });

    return defaultOptions.messageId;
  }

  /**
   * Publishes a message with headers (for headers exchange)
   */
  async publishWithHeaders(exchange, message, headers, options = {}) {
    return this.publish(exchange, '', message, {
      ...options,
      headers,
    });
  }

  /**
   * Sends a message directly to a queue
   */
  async sendToQueue(queue, message, options = {}) {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const messageBuffer = Buffer.from(JSON.stringify(message));

    const defaultOptions = {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
      messageId: this.generateMessageId(),
      ...options,
    };

    const sent = this.channel.sendToQueue(queue, messageBuffer, defaultOptions);

    if (!sent) {
      this.logger.warn('Message not sent (buffer full)', { queue });
      await new Promise((resolve) => this.channel.once('drain', resolve));
    }

    this.logger.info('Message sent to queue', {
      queue,
      messageId: defaultOptions.messageId,
    });

    return defaultOptions.messageId;
  }

  /**
   * Consumes messages from a queue
   */
  async consume(queue, handler, options = {}) {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const defaultOptions = {
      noAck: false,
      ...options,
    };

    const { consumerTag } = await this.channel.consume(
      queue,
      async (msg) => {
        if (!msg) {
          this.logger.warn('Null message received', { queue });
          return;
        }

        try {
          this.logger.info('Message received', {
            queue,
            messageId: msg.properties.messageId,
            deliveryTag: msg.fields.deliveryTag,
          });

          const content = JSON.parse(msg.content.toString());

          // Execute handler
          await handler(content, msg);

          // Acknowledge message if not auto-ack
          if (!defaultOptions.noAck) {
            this.channel.ack(msg);
            this.logger.debug('Message acknowledged', {
              queue,
              deliveryTag: msg.fields.deliveryTag,
            });
          }
        } catch (error) {
          logError(this.logger, error, {
            queue,
            messageId: msg.properties.messageId,
          });

          // Reject and requeue or send to DLX
          if (!defaultOptions.noAck) {
            const requeue = !msg.fields.redelivered; // Don't requeue if already redelivered
            this.channel.nack(msg, false, requeue);
            this.logger.warn('Message rejected', {
              queue,
              deliveryTag: msg.fields.deliveryTag,
              requeue,
            });
          }
        }
      },
      defaultOptions
    );

    this.consumers.set(queue, consumerTag);
    this.logger.info('Consumer started', { queue, consumerTag });

    return consumerTag;
  }

  /**
   * Cancels a consumer
   */
  async cancelConsumer(queue) {
    const consumerTag = this.consumers.get(queue);
    if (consumerTag && this.channel) {
      await this.channel.cancel(consumerTag);
      this.consumers.delete(queue);
      this.logger.info('Consumer cancelled', { queue, consumerTag });
    }
  }

  /**
   * Generates a unique message ID
   */
  generateMessageId() {
    return `${this.serviceName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Closes the connection gracefully
   */
  async close() {
    try {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Cancel all consumers
      for (const queue of this.consumers.keys()) {
        await this.cancelConsumer(queue);
      }

      if (this.channel) {
        await this.channel.close();
      }

      if (this.connection) {
        await this.connection.close();
      }

      this.isConnected = false;
      logRabbitMQConnection(this.logger, 'disconnected');
    } catch (error) {
      logError(this.logger, error, { event: 'close_error' });
    }
  }

  /**
   * Health check
   */
  isHealthy() {
    return this.isConnected && this.channel !== null;
  }
}

module.exports = RabbitMQClient;
