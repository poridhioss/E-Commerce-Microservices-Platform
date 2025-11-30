/**
 * Shared Module Entry Point
 * Exports all shared utilities for microservices
 */

const RabbitMQClient = require('./rabbitmq-client');
const logger = require('./logger');
const config = require('./config');

module.exports = {
  RabbitMQClient,
  logger,
  config,
};
