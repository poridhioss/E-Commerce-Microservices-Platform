# E-Commerce Microservices Platform

> A **production-grade, fully-functional E-Commerce platform** built with **Node.js microservices**, **RabbitMQ message broker**, and **Docker Compose orchestration**. Demonstrates all major RabbitMQ exchange patterns in a real-world scenario.

[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-3.13-orange)](https://www.rabbitmq.com/)

## Features

✅ **8 Production-Ready Microservices**: API Gateway, Order, Inventory, Payment, Notification, Analytics, Shipping, Audit

✅ **All RabbitMQ Exchange Patterns**: Direct, Fanout, Topic, Headers, Dead Letter Exchange (DLX)

✅ **JWT Authentication**: Secure API access with token-based authentication

✅ **Automatic Retry Logic**: Failed payments retry automatically using DLX

✅ **Comprehensive Monitoring**: Prometheus + Grafana dashboards

✅ **Docker Compose**: Complete orchestration with health checks

✅ **12-Factor App**: Cloud-native best practices

✅ **Full Event Tracing**: Complete audit trail for compliance

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd E-Commerce-Microservices-Platform

# 2. Copy environment file
cp .env.example .env

# 3. Build and start all services
docker-compose up -d --build
```
