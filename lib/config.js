'use strict'

const convict = require('convict')
const formatWithValidator = require('./config-formatters.js')
// @ts-ignore
const { version } = require('../package.json')
require('dotenv').config()

convict.addFormats(formatWithValidator)

/**
 * This makes type checking work even if we don't use typescript !
 *
 * @type {convict.Config<{
 *    port: number,
 *    host: string,
 *    frontendUrl: string,
 *    databaseUrl: string,
 *    datagouv: {
 *      datasetApiUrl: string
 *    },
 *    env: string,
 *    environment: string,
 *    reportErrors: boolean,
 *    jwtSecret: string,
 *    version: string,
 *    notifications: {
 *      endpoint: string,
 *      origin: string,
 *      publicKey: string,
 *      serviceToken: string,
 *      cartobio: {
 *        user: string,
 *        password: string
 *      },
 *      sso: {
 *        host: string,
 *        clientId: string,
 *        clientSecret: string,
 *        authorizationMethod: string,
 *        callbackUri: string
 *      }
 *    },
 *    sentry: {
 *      dsn: string
 *    }
 * }>}
 */
module.exports = convict({
  port: {
    default: 8000,
    format: 'port',
    env: 'PORT'
  },
  host: {
    default: '127.0.0.1',
    format: 'ipaddress',
    env: 'HOST'
  },
  frontendUrl: {
    default: 'https://cartobio.agencebio.org',
    format: 'url',
    env: 'FRONTEND_URL'
  },
  databaseUrl: {
    sensitive: true,
    default: 'postgresql://docker:docker@localhost:15432/gis',
    format: 'pg-url',
    env: 'DATABASE_URL'
  },
  datagouv: {
    datasetApiUrl: {
      default: 'https://www.data.gouv.fr/api/1/datasets/616d6531c2951bbe8bd97771/',
      format: 'url',
      env: 'DATAGOUV_DATASET_API_URL'
    }
  },
  env: {
    default: 'dev',
    format: ['dev', 'production', 'test'],
    env: 'NODE_ENV'
  },
  environment: {
    default: 'development',
    format: ['development', 'staging', 'production', 'test'],
    env: 'APP_ENVIRONMENT'
  },
  reportErrors: {
    default: process.env.SENTRY_DSN && process.env.NODE_ENV === 'production',
    format: Boolean,
    nullable: true,
    env: 'REPORT_ERRORS'
  },
  jwtSecret: {
    sensitive: true,
    default: null,
    format: 'jwt-token',
    env: 'CARTOBIO_JWT_SECRET'
  },
  version: {
    default: version,
    format: String
  },
  notifications: {
    endpoint: {
      default: 'https://back.agencebio.org',
      format: 'url',
      env: 'NOTIFICATIONS_AB_ENDPOINT'
    },
    origin: {
      default: '',
      format: 'url',
      env: 'NOTIFICATIONS_AB_ORIGIN'
    },
    publicKey: {
      default: '',
      env: 'NOTIFICATIONS_AB_PUBLIC_KEY',
      format: 'pub-key'
    },
    serviceToken: {
      default: '',
      env: 'NOTIFICATIONS_AB_SERVICE_TOKEN',
      format: 'uuid'
    },
    cartobio: {
      user: {
        default: null,
        format: String,
        env: 'NOTIFICATIONS_AB_CARTOBIO_USER'
      },
      password: {
        sensitive: true,
        default: null,
        format: String,
        env: 'NOTIFICATIONS_AB_CARTOBIO_PASSWORD'
      }
    },
    sso: {
      host: {
        default: 'https://oauth.agencebio.ateliom.fr',
        format: 'url',
        env: 'NOTIFICATIONS_AB_SSO_HOST'
      },
      clientId: {
        default: null,
        format: String,
        env: 'NOTIFICATIONS_AB_SSO_CLIENT_ID'
      },
      clientSecret: {
        sensitive: true,
        default: null,
        format: String,
        env: 'NOTIFICATIONS_AB_SSO_CLIENT_SECRET'
      },
      authorizationMethod: {
        default: 'header',
        // body: in staging
        // header: in production
        format: ['body', 'header'],
        env: 'NOTIFICATIONS_AB_SSO_AUTHORIZATION_METHOD'
      },
      callbackUri: {
        default: 'https://cartobio.agencebio.org/api/auth-provider/agencebio/callback',
        format: 'url',
        env: 'NOTIFICATIONS_AB_SSO_CALLBACK_URI'
      }
    }
  },
  sentry: {
    dsn: {
      default: '',
      format: 'url',
      env: 'SENTRY_DSN'
    }
  }
})
