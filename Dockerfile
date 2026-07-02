FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=30141 \
    WORKSPACE_ROOT=/workspace \
    HOME=/home/node
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /workspace /home/node/.pi/agent && chown -R node:node /workspace /home/node
USER node
EXPOSE 30141
CMD ["node", "dist/server/index.js"]
