# x-computer Server Dockerfile
FROM node:22-alpine

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ curl

# Copy root config files first for better caching
COPY package.json package-lock.json tsconfig.json ./
COPY shared/package.json shared/
COPY server/package.json server/

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build shared and server
RUN npm run build

# Create data directory
RUN mkdir -p data

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:4000/api/health || exit 1

# Start server
CMD ["npm", "run", "start"]
