# E-Commerce Microservices Platform - Makefile
# Convenient commands for managing the platform

.PHONY: help build start stop restart logs clean test health status rabbitmq grafana prometheus

# Default target
.DEFAULT_GOAL := help

# Colors for output
YELLOW := \033[1;33m
GREEN := \033[0;32m
RED := \033[0;31m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(YELLOW)E-Commerce Microservices Platform$(NC)"
	@echo ""
	@echo "$(GREEN)Available commands:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(YELLOW)%-15s$(NC) %s\n", $$1, $$2}'

build: ## Build all services
	@echo "$(GREEN)Building all services...$(NC)"
	docker-compose build

start: ## Start all services
	@echo "$(GREEN)Starting all services...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)Services started!$(NC)"
	@echo "Waiting for services to be healthy..."
	@sleep 10
	@make status

stop: ## Stop all services
	@echo "$(YELLOW)Stopping all services...$(NC)"
	docker-compose stop
	@echo "$(GREEN)Services stopped$(NC)"

down: ## Stop and remove all containers
	@echo "$(RED)Stopping and removing all containers...$(NC)"
	docker-compose down
	@echo "$(GREEN)Cleanup complete$(NC)"

restart: ## Restart all services
	@echo "$(YELLOW)Restarting all services...$(NC)"
	docker-compose restart
	@echo "$(GREEN)Services restarted$(NC)"

logs: ## View logs from all services
	docker-compose logs -f

logs-order: ## View Order Service logs
	docker-compose logs -f order-service

logs-payment: ## View Payment Service logs
	docker-compose logs -f payment-service

logs-rabbitmq: ## View RabbitMQ logs
	docker-compose logs -f rabbitmq

status: ## Check status of all services
	@echo "$(YELLOW)Service Status:$(NC)"
	@docker-compose ps

health: ## Check health of all services
	@echo "$(YELLOW)Health Checks:$(NC)"
	@echo "API Gateway:    $$(curl -s http://localhost:3000/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"
	@echo "Order Service:  $$(curl -s http://localhost:3001/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"
	@echo "Inventory:      $$(curl -s http://localhost:3002/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"
	@echo "Payment:        $$(curl -s http://localhost:3003/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"
	@echo "Notification:   $$(curl -s http://localhost:3004/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"
	@echo "Analytics:      $$(curl -s http://localhost:3005/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"
	@echo "Shipping:       $$(curl -s http://localhost:3006/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"
	@echo "Audit:          $$(curl -s http://localhost:3007/health | grep -o '"status":"[^"]*' | cut -d'"' -f4 || echo 'DOWN')"

clean: ## Remove all containers, volumes, and images
	@echo "$(RED)WARNING: This will remove all data!$(NC)"
	@echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
	@sleep 5
	docker-compose down -v --rmi all
	@echo "$(GREEN)Complete cleanup done$(NC)"

test: ## Run API tests
	@echo "$(GREEN)Running API tests...$(NC)"
	@chmod +x test-api.sh
	@./test-api.sh

rabbitmq: ## Open RabbitMQ Management UI
	@echo "$(GREEN)Opening RabbitMQ Management UI...$(NC)"
	@echo "URL: http://localhost:15672"
	@echo "Username: admin"
	@echo "Password: admin123"

grafana: ## Open Grafana Dashboards
	@echo "$(GREEN)Opening Grafana...$(NC)"
	@echo "URL: http://localhost:3010"
	@echo "Username: admin"
	@echo "Password: admin123"

prometheus: ## Open Prometheus
	@echo "$(GREEN)Opening Prometheus...$(NC)"
	@echo "URL: http://localhost:9090"

scale-order: ## Scale Order Service to 3 instances
	@echo "$(GREEN)Scaling Order Service to 3 instances...$(NC)"
	docker-compose up -d --scale order-service=3
	@make status

scale-payment: ## Scale Payment Service to 2 instances
	@echo "$(GREEN)Scaling Payment Service to 2 instances...$(NC)"
	docker-compose up -d --scale payment-service=2
	@make status

scale-down: ## Scale all services back to 1 instance
	@echo "$(YELLOW)Scaling all services back to 1 instance...$(NC)"
	docker-compose up -d --scale order-service=1 --scale payment-service=1
	@make status

install: ## Initial setup and installation
	@echo "$(GREEN)Setting up E-Commerce Microservices Platform...$(NC)"
	@if [ ! -f .env ]; then \
		echo "Creating .env file..."; \
		cp .env.example .env; \
		echo "$(YELLOW)Please review and update .env file if needed$(NC)"; \
	fi
	@echo "$(GREEN)Building services...$(NC)"
	@make build
	@echo "$(GREEN)Starting services...$(NC)"
	@make start
	@echo ""
	@echo "$(GREEN)Installation complete!$(NC)"
	@echo ""
	@echo "$(YELLOW)Access Points:$(NC)"
	@echo "  API Gateway:  http://localhost:3000"
	@echo "  RabbitMQ:     http://localhost:15672"
	@echo "  Grafana:      http://localhost:3010"
	@echo "  Prometheus:   http://localhost:9090"
	@echo ""
	@echo "$(GREEN)Run 'make test' to test the platform$(NC)"

dev: ## Run in development mode with logs
	docker-compose up --build

analytics: ## View analytics dashboard
	@curl -s http://localhost:3005/dashboard | python -m json.tool || echo "Analytics service not responding"

audit: ## View recent audit logs
	@curl -s "http://localhost:3007/audit?limit=10" | python -m json.tool || echo "Audit service not responding"

inventory: ## View inventory status
	@curl -s http://localhost:3002/inventory | python -m json.tool || echo "Inventory service not responding"
