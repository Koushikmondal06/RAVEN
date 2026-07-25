# Next.js static export: build with node, serve the out/ with nginx. NEXT_PUBLIC_* are baked in at
# build time, so pass NEXT_PUBLIC_REGISTRY_URL as a build arg (compose does this from .env).
FROM node:22-slim AS build
# Default to the same-origin /api path this image's nginx proxies to the backend. It must not default
# to an absolute URL: .dockerignore keeps web/.env out of the build context, so this ARG is the ONLY
# source of the value — a `localhost` default silently bakes the visitor's own machine into the bundle
# and every request dies as "Failed to fetch". Override only for a registry on its own https host:
#   docker compose build --build-arg NEXT_PUBLIC_REGISTRY_URL=https://api.example.com web
ARG NEXT_PUBLIC_REGISTRY_URL=/api
ARG NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_SOLANA_CLUSTER=devnet
ARG MAINNET=false
ENV NEXT_PUBLIC_REGISTRY_URL=$NEXT_PUBLIC_REGISTRY_URL \
    NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL \
    NEXT_PUBLIC_SOLANA_CLUSTER=$NEXT_PUBLIC_SOLANA_CLUSTER \
    MAINNET=$MAINNET \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY web/package.json web/
RUN cd web && npm install
COPY shared/ shared/
COPY web/ web/
RUN cd web && npm run build

FROM nginx:alpine
# Serves the static bundle AND reverse-proxies /api/ to the registry, so the browser only ever talks
# to this one origin (no mixed content, no baked-in localhost). See web/nginx.conf.
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/out /usr/share/nginx/html
EXPOSE 80
