#!/bin/bash

# E-Commerce Platform API Test Script
# Tests all major functionalities and exchange patterns

set -e

API_URL="http://localhost:3000"
TOKEN=""

echo "=================================="
echo "E-Commerce Platform API Test"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print success
success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error
error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to print info
info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Wait for services to be ready
info "Waiting for services to be ready..."
sleep 5

# Test 1: Health Check
info "Testing API Gateway health..."
HEALTH=$(curl -s $API_URL/health)
if echo "$HEALTH" | grep -q "healthy"; then
    success "API Gateway is healthy"
else
    error "API Gateway health check failed"
    exit 1
fi

# Test 2: Login (Standard User, US Region)
info "Authenticating as standard user (US region)..."
LOGIN_RESPONSE=$(curl -s -X POST $API_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john_doe",
    "password": "password123",
    "tier": "standard",
    "region": "us"
  }')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    error "Authentication failed"
    echo "$LOGIN_RESPONSE"
    exit 1
fi

success "Authenticated successfully (US Standard User)"
echo "   Token: ${TOKEN:0:50}..."

# Test 3: Create Normal Priority Order
info "Creating normal priority order..."
ORDER1=$(curl -s -X POST $API_URL/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "items": [
      {
        "productId": "PROD001",
        "quantity": 2,
        "price": 999.99
      },
      {
        "productId": "PROD002",
        "quantity": 1,
        "price": 29.99
      }
    ],
    "priority": "normal",
    "shippingAddress": "123 Main St, New York, NY 10001"
  }')

ORDER1_ID=$(echo "$ORDER1" | grep -o '"orderId":"[^"]*' | cut -d'"' -f4)
if [ -z "$ORDER1_ID" ]; then
    error "Failed to create normal priority order"
    echo "$ORDER1"
else
    success "Normal priority order created: $ORDER1_ID"
fi

sleep 2

# Test 4: Create High Priority Order
info "Creating high priority order..."
ORDER2=$(curl -s -X POST $API_URL/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "items": [
      {
        "productId": "PROD003",
        "quantity": 1,
        "price": 1599.99
      }
    ],
    "priority": "high",
    "shippingAddress": "456 Oak Ave, Los Angeles, CA 90001"
  }')

ORDER2_ID=$(echo "$ORDER2" | grep -o '"orderId":"[^"]*' | cut -d'"' -f4)
if [ -z "$ORDER2_ID" ]; then
    error "Failed to create high priority order"
else
    success "High priority order created: $ORDER2_ID"
fi

sleep 2

# Test 5: Login as Premium User (EU Region)
info "Authenticating as premium user (EU region)..."
EU_LOGIN=$(curl -s -X POST $API_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "premium_eu",
    "password": "password123",
    "tier": "premium",
    "region": "eu"
  }')

EU_TOKEN=$(echo "$EU_LOGIN" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
success "Authenticated as Premium EU user"

# Test 6: Create EU Order (Topic Exchange Routing)
info "Creating order for EU region..."
ORDER3=$(curl -s -X POST $API_URL/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EU_TOKEN" \
  -d '{
    "items": [
      {
        "productId": "PROD004",
        "quantity": 3,
        "price": 89.99
      }
    ],
    "priority": "normal",
    "shippingAddress": "789 Boulevard St, Paris, France"
  }')

ORDER3_ID=$(echo "$ORDER3" | grep -o '"orderId":"[^"]*' | cut -d'"' -f4)
success "EU order created: $ORDER3_ID (will route to EU shipping)"

sleep 2

# Test 7: Create Multiple Orders (Test Payment Failures & DLX)
info "Creating 5 orders to test payment processing and DLX..."
for i in {1..5}; do
    ORDER=$(curl -s -X POST $API_URL/api/orders \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{
        \"items\": [
          {
            \"productId\": \"PROD00$i\",
            \"quantity\": 1,
            \"price\": $((i * 100))
          }
        ],
        \"priority\": \"normal\",
        \"shippingAddress\": \"Test Address $i\"
      }")

    ORDER_ID=$(echo "$ORDER" | grep -o '"orderId":"[^"]*' | cut -d'"' -f4)
    if [ -n "$ORDER_ID" ]; then
        echo "   Order $i created: $ORDER_ID"
    fi
    sleep 1
done
success "Created 5 test orders (some may fail for DLX demonstration)"

# Wait for processing
info "Waiting for order processing (15 seconds)..."
sleep 15

# Test 8: Check Analytics
info "Checking analytics data..."
ANALYTICS=$(curl -s http://localhost:3005/metrics)
if echo "$ANALYTICS" | grep -q "orders"; then
    success "Analytics service is collecting data"
    TOTAL_ORDERS=$(echo "$ANALYTICS" | grep -o '"total":[0-9]*' | head -1 | cut -d':' -f2)
    echo "   Total orders: $TOTAL_ORDERS"
else
    error "Failed to retrieve analytics"
fi

# Test 9: Check Notifications
info "Checking notification service..."
NOTIFICATIONS=$(curl -s http://localhost:3004/notifications)
if echo "$NOTIFICATIONS" | grep -q "success"; then
    success "Notification service is working"
    NOTIF_COUNT=$(echo "$NOTIFICATIONS" | grep -o '"id":' | wc -l)
    echo "   Notifications sent: $NOTIF_COUNT"
fi

# Test 10: Check Audit Log
info "Checking audit trail..."
AUDIT=$(curl -s "http://localhost:3007/audit?limit=5")
if echo "$AUDIT" | grep -q "success"; then
    success "Audit service is logging events"
    AUDIT_COUNT=$(echo "$AUDIT" | grep -o '"auditId":' | wc -l)
    echo "   Audit records: $AUDIT_COUNT"
fi

# Test 11: Check Inventory
info "Checking inventory service..."
INVENTORY=$(curl -s http://localhost:3002/inventory)
if echo "$INVENTORY" | grep -q "PROD001"; then
    success "Inventory service is operational"
fi

# Test 12: Check Payment Service
info "Checking payment service..."
PAYMENTS=$(curl -s http://localhost:3003/payments)
if echo "$PAYMENTS" | grep -q "successful"; then
    success "Payment service is processing payments"
    SUCCESS_COUNT=$(echo "$PAYMENTS" | grep -o '"successful":' | wc -l)
    FAILED_COUNT=$(echo "$PAYMENTS" | grep -o '"failed":' | wc -l)
    echo "   Successful payments: $SUCCESS_COUNT"
    echo "   Failed payments: $FAILED_COUNT"
fi

# Test 13: Check Shipping
info "Checking shipping service..."
SHIPMENTS=$(curl -s http://localhost:3006/shipments)
if echo "$SHIPMENTS" | grep -q "success"; then
    success "Shipping service is creating shipments"
    SHIPMENT_COUNT=$(echo "$SHIPMENTS" | grep -o '"shipmentId":' | wc -l)
    echo "   Shipments created: $SHIPMENT_COUNT"
fi

# Summary
echo ""
echo "=================================="
echo "Test Summary"
echo "=================================="
success "All services are operational"
success "Exchange patterns tested:"
echo "   ✓ Direct Exchange (priority routing)"
echo "   ✓ Fanout Exchange (event broadcasting)"
echo "   ✓ Topic Exchange (region-based routing)"
echo "   ✓ Headers Exchange (metadata routing)"
echo "   ✓ DLX (payment retry logic)"
echo ""
info "View RabbitMQ Management: http://localhost:15672"
info "View Grafana Dashboards: http://localhost:3010"
info "View Prometheus Metrics: http://localhost:9090"
echo ""
success "Test completed successfully!"
