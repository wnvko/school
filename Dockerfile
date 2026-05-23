# Stage 1: Build Angular frontend
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npx ng build --configuration production

# Stage 2: Production image — Node.js server only
FROM node:22-alpine

WORKDIR /app

# Copy the server and built frontend
COPY server/ ./server/
COPY --from=build /app/dist ./dist

# Create data directory
RUN mkdir -p /app/server/data

EXPOSE 3000

CMD ["node", "server/server.mjs"]
