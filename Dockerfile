# Use Bun's official image as base
FROM oven/bun:1-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY bun.lock ./

# Install dependencies
RUN bun install --production

# Copy source code
COPY src/ ./src/
COPY .env ./
COPY tsconfig.json ./

# Expose port
EXPOSE 3000

# Run the server
CMD ["bun", "run", "src/index.ts"]