FROM node:24-slim

ENV CHROME_BIN="/usr/bin/chromium" \
    PUPPETEER_SKIP_DOWNLOAD="true" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-freefont-ttf \
      ca-certificates \
      curl \
      unzip \
      libgl1 \
      libegl1 \
      libgl1-mesa-dri \
 && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY --chown=node:node package*.json ./
COPY --chown=node:node packages/cartobio-types/package.json ./packages/cartobio-types/package.json

# gdal-async : on Debian (glibc), the pre-built binary is downloaded, no compilation needed
# https://www.npmjs.com/package/gdal-async#user-content-unit-tested-platforms-with-pre-built-binaries
# Note: no arm64 pre-built binary for Node 24 -> on arm64, add python3 make g++ above
RUN npm ci

# Bundle app source and compile TypeScript (dist/)
COPY --chown=node:node tsconfig.base.json tsconfig.json tsconfig.build.json ./
COPY --chown=node:node ./packages ./packages
COPY --chown=node:node ./src ./src
COPY --chown=node:node ./bin ./bin
RUN npm run build

# Build geo data files
COPY --chown=node:node ./data ./data
RUN npm run build:geo-data && npm prune --omit=dev

COPY --chown=node:node drizzle.config.ts ./
COPY --chown=node:node ./database/drizzle ./database/drizzle
COPY --chown=node:node ./assets ./assets
COPY --chown=node:node ./storage/pdf ./storage/pdf/

EXPOSE 8000
ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0 \
    CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/v3/health || exit 1

USER node

CMD [ "npm", "start" ]
