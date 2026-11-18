import 'dotenv/config'
import convict from 'convict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import formatWithValidator from './config-formatters.js'
import { ROOT_DIR } from '../shared/paths.js'

const { version } = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'))

convict.addFormats(formatWithValidator)

interface AppConfig {
  port: number
  host: string
  frontendUrl: string
  databaseUrl: string
  drizzleDatabaseUrl: string
  testDatabaseName: string
  douanes: {
    baseUrl: string
    socksProxy: string
  }
  geofolia: {
    api: {
      host: string
      serviceCode: string
      scope: string
      subscriptionKey: string
    }
    oauth: {
      clientId: string
      clientSecret: string
      host: string
      tenant: string
      callbackUri: string
    }
  }
  env: string
  environment: string
  jwtSecret: string
  version: string
  notifications: {
    endpoint: string
    origin: string
    publicKey: string
    serviceToken: string
    sso: {
      host: string
      clientId: string
      clientSecret: string
      authorizationMethod: string
      callbackUri: string
    }
  }
  attestationsProductions: {
    directory: string
  }
  mail: {
    mailUrl: string
  }
}

const config = convict<AppConfig>({
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
  drizzleDatabaseUrl: {
    sensitive: true,
    default: 'postgresql://docker:docker@localhost:25432/cartobio',
    format: 'pg-url',
    env: 'TARGET_DATABASE_URL'
  },
  testDatabaseName: {
    sensitive: true,
    default: 'test'
  },
  geofolia: {
    api: {
      host: {
        default: 'https://prod-geofolink.azure-api.net',
        format: 'url',
        env: 'GEOFOLIA_API_HOST'
      },
      scope: {
        default: 'https://b2cprodgeofolink.onmicrosoft.com/prod-geofolink/.default',
        format: 'url',
        env: 'GEOFOLIA_API_SCOPE'
      },
      serviceCode: {
        default: 'FR-CARTOBIO-DATA-FIELDS',
        format: String,
        env: 'GEOFOLIA_API_SERVICE_CODE'
      },
      subscriptionKey: {
        default: null,
        format: 'url',
        env: 'GEOFOLIA_API_SUBSCRIPTION_KEY'
      }
    },
    oauth: {
      clientId: {
        default: null,
        format: 'uuid',
        env: 'GEOFOLIA_OAUTH_CLIENT_ID'
      },
      clientSecret: {
        default: null,
        format: String,
        env: 'GEOFOLIA_OAUTH_CLIENT_SECRET'
      },
      host: {
        default: 'https://login.microsoftonline.com/',
        format: 'url',
        env: 'GEOFOLIA_OAUTH_HOST'
      },
      tenant: {
        default: null,
        format: String,
        env: 'GEOFOLIA_OAUTH_TENANT'
      },
      callbackUri: {
        default: 'http://127.0.0.1:8000/api/login/geofolia/callback',
        format: 'url',
        env: 'GEOFOLIA_OAUTH_CALLBACK_URI'
      }
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
  jwtSecret: {
    sensitive: true,
    default: '',
    format: String,
    env: 'CARTOBIO_JWT_SECRET'
  },
  version: {
    default: version,
    format: String
  },
  douanes: {
    baseUrl: {
      default: 'http://bdd-cartobio/ws',
      format: 'url',
      env: 'DOUANES_BASE_URL'
    },
    socksProxy: {
      sensitive: true,
      default: '',
      format: 'url',
      env: 'DOUANES_SOCKS_PROXY'
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
      env: 'NOTIFICATIONS_AB_SERVICE_TOKEN',
      format: 'uuid'
    },
    sso: {
      host: {
        default: 'https://preprod-oauth.agencebio.org',
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
  attestationsProductions: {
    directory: {
      default: '.',
      env: 'ATTESTATIONS_PRODUCTIONS_DIRECTORY'
    }
  },
  mail: {
    mailUrl: {
      default: 'smtp://localhost:1025',
      format: 'url',
      env: 'MAIL_URL'
    }
  }
})

export default config
