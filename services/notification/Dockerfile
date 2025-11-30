FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY shared/ /app/shared/
WORKDIR /app/shared
RUN npm install --production

WORKDIR /app/service
COPY services/notification/package*.json ./
RUN npm install --production
COPY services/notification/ ./

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3004/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3004
USER node
CMD ["node", "index.js"]
