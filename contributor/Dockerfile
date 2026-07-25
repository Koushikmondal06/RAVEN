FROM node:22-slim
# ponytail: docker.io drags in the daemon we never start; swap for docker-ce-cli if image size matters.
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY contributor/package.json contributor/
RUN cd contributor && npm install
COPY shared/ shared/
COPY contributor/ contributor/
WORKDIR /app/contributor
CMD ["npx", "tsx", "src/index.ts"]
