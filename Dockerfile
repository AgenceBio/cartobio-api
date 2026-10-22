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

# gdal-async : on Debian (glibc), the pre-built binary is downloaded, no compilation needed
# https://www.npmjs.com/package/gdal-async#user-content-unit-tested-platforms-with-pre-built-binaries
# Note: no arm64 pre-built binary for Node 24 -> on arm64, add python3 make g++ above

# Build geo data files
COPY --chown=node:node ./bin ./bin
COPY --chown=node:node ./data ./data

RUN npm ci
RUN npm run build:geo-data

# Bundle app source
COPY --chown=node:node ./lib ./lib
COPY --chown=node:node ./migrations ./migrations
COPY --chown=node:node ./image-map ./image-map
COPY --chown=node:node ./pdf ./pdf/
COPY --chown=node:node ./*.js ./
COPY --chown=node:node ./*.d.ts ./
COPY --chown=node:node ./eslint.config.js ./eslint.config.js
COPY --chown=node:node ./jsconfig.json ./jsconfig.json
COPY --chown=node:node ./tsconfig.json ./tsconfig.json

EXPOSE 8000
ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0 \
    CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/v3/health || exit 1

USER node

CMD [ "npm", "start" ]