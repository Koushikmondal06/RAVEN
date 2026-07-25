FROM node:22-slim
WORKDIR /app
# Install into /app/node_modules (not backend/) so shared/env.ts — which imports dotenv and lives
# one level up — resolves it too. Mirrors the workspace hoisting that npm does locally.
COPY backend/package.json ./package.json
RUN npm install
COPY shared/ shared/
COPY backend/ backend/
WORKDIR /app/backend
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
