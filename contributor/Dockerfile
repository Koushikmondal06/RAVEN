# The contributor daemon, for the local-dev `container` tier ONLY (SANDBOX_BACKEND=docker). It cannot
# deliver the rentable `microvm` tier: Firecracker needs /dev/kvm, root tap networking, and the
# firecracker/jailer binaries on the host. A real contributor runs the daemon natively —
# see contributor/README.md. That's also why there is no `contributor` service in docker-compose.yml.
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
