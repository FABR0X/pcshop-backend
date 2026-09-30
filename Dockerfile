FROM node:24-alpine

WORKDIR /app

# Install with the lockfile first so a dependency-only change reuses this layer.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./
COPY src ./src

# Run unprivileged. node:alpine already ships a `node` user (uid 1000).
USER node

EXPOSE 3000

CMD ["node", "server.js"]
