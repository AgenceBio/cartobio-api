FROM node:18-alpine

RUN apk add --update unzip gdal-dev cmake build-base python3

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

# If building deps fails, the answer is: aim for pre-built binaries
# https://www.npmjs.com/package/gdal-async#user-content-unit-tested-platforms-with-pre-built-binaries
# And until arm64 prebuilt images are provided, we branch out
# https://github.com/mmomtchev/node-gdal-async/issues/30#issuecomment-1275888379

# Build geo data files
COPY ./bin ./bin
COPY ./data ./data

RUN npm ci --build-from-source --shared_gdal
RUN npm run build:geo-data


# Bundle app source
COPY ./__mocks__ ./__mocks__
COPY ./lib ./lib
COPY ./migrations ./migrations
COPY ./test ./test
COPY ./*.js ./
COPY ./.eslintrc.js ./.eslintrc.js
COPY ./jsconfig.json ./jsconfig.json
COPY ./tsconfig.json ./tsconfig.json

EXPOSE  8000
ENV     NODE_ENV  production
ENV     PORT      8000
ENV     HOST      0.0.0.0

CMD [ "npm", "start" ]
