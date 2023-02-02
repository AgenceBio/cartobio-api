'use strict'

const convict = require('convict')
const formatWithValidator = require('./config-formatters.js')
const { version } = require('../package.json')
require('dotenv').config()

convict.addFormats(formatWithValidator)

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
  env: {
    default: 'dev',
    format: ['dev', 'production', 'test'],
    env: 'NODE_ENV'
  },
  environment: {
    default: 'development',
    format: ['development', 'staging', 'production'],
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
  mattermost: {
    secret: {
      sensitive: true,
      default: '',
      format: String,
      env: 'MATTERMOST_SECRET'
    }
  },
  matomo: {
    siteId: {
      default: 116,
      format: 'int',
      env: 'MATOMO_SITE_ID'
    },
    trackerUrl: {
      default: 'https://stats.data.gouv.fr/piwik.php',
      format: 'url',
      env: 'MATOMO_TRACKER_URL'
    }
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
      format: 'uuid',
      env: 'NOTIFICATIONS_AB_SERVICE_TOKEN',
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
