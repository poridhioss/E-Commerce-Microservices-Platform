FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy shared modules
COPY shared/ /app/shared/
WORKDIR /app/shared
RUN npm install --production

# Copy service files
WORKDIR /app/api-gateway
COPY api-gateway/package*.json ./
RUN npm install --production

COPY api-gateway/ ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Expose port
EXPOSE 3000

# Run as non-root user
USER node

CMD ["node", "index.js"]
