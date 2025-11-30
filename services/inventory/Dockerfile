FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY shared/ /app/shared/
WORKDIR /app/shared
RUN npm install --production

WORKDIR /app/service
COPY services/inventory/package*.json ./
RUN npm install --production
COPY services/inventory/ ./

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3002
USER node
CMD ["node", "index.js"]
