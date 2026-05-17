# Use Node.js 20 Alpine for minimal footprint
FROM node:20-alpine

# Set environment variables
ENV PUID=1001 \
    PGID=1001 \
    PATH=/app/node_modules/.bin:$PATH

# Set working directory
WORKDIR /app

# Install gosu for proper user switching
RUN apk add --no-cache gosu bash

# Copy package files first for better layer caching
COPY package.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for build)
RUN npm install && npm cache clean --force

# Copy source code
COPY src ./src

# Debug and build TypeScript
RUN echo "Checking typescript installation..." && \
    npm list typescript && \
    find node_modules -name tsc -type f && \
    npx tsc

# Remove source files and dev dependencies to reduce image size, then set production mode
RUN rm -rf src tsconfig.json node_modules && \
    NODE_ENV=production npm install --only=production && \
    npm cache clean --force

# Set production environment
ENV NODE_ENV=production

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose application port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5000/ || exit 1

# Run application with entrypoint script
ENTRYPOINT ["/entrypoint.sh"]
