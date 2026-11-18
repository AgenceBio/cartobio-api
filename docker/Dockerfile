FROM node:24-alpine3.22

RUN apk add --update unzip gdal-dev cmake build-base python3

ENV CHROME_BIN="/usr/bin/chromium-browser" \
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"

RUN apk add --no-cache \
      chromium-swiftshader \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      nodejs \
      yarn \
      mesa-dri-gallium \
      mesa-egl \
      mesa-gl \
      libx11-dev \
      libxext-dev \
      curl

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY --chown=node:node package*.json ./
COPY --chown=node:node packages/cartobio-types/package.json ./packages/cartobio-types/package.json

# If building deps fails, the answer is: aim for pre-built binaries
# https://www.npmjs.com/package/gdal-async#user-content-unit-tested-platforms-with-pre-built-binaries
# And until arm64 prebuilt images are provided, we branch out
# https://github.com/mmomtchev/node-gdal-async/issues/30#issuecomment-1275888379
RUN npm ci --build-from-source --shared_gdal

# Bundle app source and compile TypeScript (dist/)
COPY --chown=node:node tsconfig.base.json tsconfig.json tsconfig.build.json ./
COPY --chown=node:node ./packages ./packages
COPY --chown=node:node ./src ./src
COPY --chown=node:node ./bin ./bin
RUN npm run build

# Build geo data files
COPY --chown=node:node ./data ./data
RUN npm run build:geo-data

COPY --chown=node:node ./database/old_migrations ./database/old_migrations
COPY --chown=node:node ./assets ./assets
COPY --chown=node:node ./storage/pdf ./storage/pdf/

EXPOSE  8000
ENV     NODE_ENV  production
ENV     PORT      8000
ENV     HOST      0.0.0.0

ENV CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/v3/health || exit 1

USER node

CMD [ "npm", "start" ]
