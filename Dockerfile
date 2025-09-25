# syntax=docker/dockerfile:1

# Base image with Node.js available for all stages
FROM node:20-slim AS base
WORKDIR /app

# Install all dependencies (including dev deps required for the build)
FROM base AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

# Build the client bundle
FROM deps AS build
COPY client ./client
COPY shared ./shared
COPY public ./public
COPY server ./server
COPY vite.config.js ./
RUN npm run build

# Remove dev dependencies for the runtime image
FROM deps AS prune
RUN npm prune --omit=dev

# Final production image
FROM node:20-slim AS production
ENV NODE_ENV=production
WORKDIR /app

# Copy production dependencies and application code
COPY --from=prune /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY --from=build /app/dist ./dist

# Create and switch to an unprivileged user
RUN useradd --system --uid 1001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000
CMD ["node", "server/server.js"]
