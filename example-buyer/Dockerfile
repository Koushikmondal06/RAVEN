FROM node:22-slim
WORKDIR /app
COPY example-buyer/package.json example-buyer/
RUN cd example-buyer && npm install
COPY shared/ shared/
COPY example-buyer/ example-buyer/
WORKDIR /app/example-buyer
CMD ["npx", "tsx", "src/index.ts"]
