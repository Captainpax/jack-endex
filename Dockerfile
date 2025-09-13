# Use a lightweight Node.js image for build and runtime
FROM node:20-alpine AS build

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source files and build the client
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine AS production
WORKDIR /app

# Copy only the package.json files and install production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy necessary application files
COPY server.js ./
COPY routes ./routes
COPY data ./data
COPY public ./public
COPY --from=build /app/dist ./dist

# Expose the port the app runs on
EXPOSE 3000

# Start the server
CMD ["npm", "start"]