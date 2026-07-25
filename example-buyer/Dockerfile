FROM node:22-slim
WORKDIR /app
# Install into /app/node_modules so shared/env.ts + shared/cluster.ts resolve their deps one level up.
COPY example-buyer/package.json ./package.json
RUN npm install
COPY shared/ shared/
COPY example-buyer/ example-buyer/
WORKDIR /app/example-buyer
CMD ["npx", "tsx", "src/index.ts"]
