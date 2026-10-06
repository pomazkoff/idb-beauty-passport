FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ARG VITE_API_BASE=http://localhost:3000
ARG VITE_WEB_BASE=http://localhost:8080
ENV VITE_API_BASE=$VITE_API_BASE VITE_WEB_BASE=$VITE_WEB_BASE
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/*" build && pnpm --filter @idb/admin build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
