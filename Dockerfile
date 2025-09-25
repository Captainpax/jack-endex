# Multi-stage build for Jack Endex
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies (including dev deps for build)
FROM base AS deps
COPY package*.json ./
RUN npm ci

# Build the client bundle
FROM deps AS build
COPY . .
RUN npm run build

# Prune dev dependencies for production
FROM deps AS prune
RUN npm prune --omit=dev

# Final runtime image
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

# Copy production node_modules and application code
COPY --from=prune /app/node_modules ./node_modules
COPY package*.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY --from=build /app/dist ./dist

# Drop privileges to a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000
CMD ["node", "server/server.js"]
