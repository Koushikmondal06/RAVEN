# The contributor daemon. It talks to the HOST's Docker daemon through the mounted socket and starts
# each lease as a sibling container there — so this image ships only the CLI, never a daemon of its
# own. Run it with `docker compose up -d --build contributor`; see contributor/README.md.
FROM node:22-slim
# ponytail: docker.io drags in the daemon we never start; swap for docker-ce-cli if image size matters.
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Install into /app/node_modules so shared/env.ts (imports dotenv, lives one level up) resolves it.
COPY contributor/package.json ./package.json
RUN npm install
COPY shared/ shared/
COPY contributor/ contributor/
WORKDIR /app/contributor
CMD ["npx", "tsx", "src/index.ts"]
