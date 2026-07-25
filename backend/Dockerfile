FROM node:22-slim
WORKDIR /app
COPY backend/package.json backend/
RUN cd backend && npm install
COPY shared/ shared/
COPY backend/ backend/
WORKDIR /app/backend
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
