FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/*" build && pnpm --filter @idb/api build

FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
