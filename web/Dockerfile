# Next.js static export: build with node, serve the out/ with nginx. NEXT_PUBLIC_* are baked in at
# build time, so pass NEXT_PUBLIC_REGISTRY_URL as a build arg (compose does this from .env).
FROM node:22-slim AS build
ARG NEXT_PUBLIC_REGISTRY_URL=http://localhost:4000
ARG NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_SOLANA_CLUSTER=devnet
ENV NEXT_PUBLIC_REGISTRY_URL=$NEXT_PUBLIC_REGISTRY_URL \
    NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL \
    NEXT_PUBLIC_SOLANA_CLUSTER=$NEXT_PUBLIC_SOLANA_CLUSTER \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY web/package.json web/
RUN cd web && npm install
COPY shared/ shared/
COPY web/ web/
RUN cd web && npm run build

FROM nginx:alpine
# SPA fallback: every route serves index.html.
RUN printf 'server{listen 80;root /usr/share/nginx/html;location /{try_files $uri $uri.html /index.html;}}' > /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/out /usr/share/nginx/html
EXPOSE 80
