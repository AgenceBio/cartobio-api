FROM node:24-slim AS node-base
WORKDIR /usr/src/app
ENV PUPPETEER_SKIP_DOWNLOAD="true" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
COPY package*.json ./
COPY packages/cartobio-types/package.json ./packages/cartobio-types/package.json

# gdal-async : on Debian (glibc), the pre-built binary is downloaded, no compilation needed
# https://www.npmjs.com/package/gdal-async#user-content-unit-tested-platforms-with-pre-built-binaries
# Note: no arm64 pre-built binary for Node 24 -> on arm64, add python3 make g++ to the build stages
FROM node-base AS build
RUN npm ci
COPY tsconfig.base.json tsconfig.json tsconfig.build.json ./
COPY packages ./packages
COPY src ./src
COPY bin ./bin
RUN npm run build
COPY data ./data
RUN npm run build:geo-data

FROM node-base AS prod-deps
RUN npm ci --omit=dev

FROM node:24-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-freefont-ttf \
      ca-certificates \
      curl \
      libgl1 \
      libegl1 \
      libgl1-mesa-dri \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
RUN chown node:node /usr/src/app

COPY --chown=node:node package*.json drizzle.config.ts ./
COPY --chown=node:node packages/cartobio-types/package.json ./packages/cartobio-types/package.json
COPY --chown=node:node --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/packages/cartobio-types/dist ./packages/cartobio-types/dist
COPY --chown=node:node --from=build /usr/src/app/dist ./dist
COPY --chown=node:node --from=build /usr/src/app/data ./data
COPY --chown=node:node src/services/mailer/templates ./src/services/mailer/templates
COPY --chown=node:node database/drizzle ./database/drizzle
COPY --chown=node:node assets ./assets
COPY --chown=node:node storage ./storage

EXPOSE 8000
ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0 \
    CHROME_BIN="/usr/bin/chromium" \
    PUPPETEER_SKIP_DOWNLOAD="true" \
    CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/v3/health || exit 1

USER node

CMD [ "npm", "start" ]
