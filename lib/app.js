'use strict'

const { version } = require('../package.json')

function requiredEnv (variables = [], env = process.env) {
  const missingVariables = variables.filter(variable => {
    return env[variable] === undefined
  })

  if (missingVariables.length) {
    throw new Error('Missing environment variables: %a', missingVariables)
  }
}

function env () {
  return {
    PORT: 8000,
    HOST: 'localhost',
    FRONTEND_URL: 'https://cartobio.agencebio.org',
    DATABASE_URL: 'postgresql://docker:docker@localhost:15432/gis',
    MATTERMOST_SECRET: null,
    MATOMO_SITE_ID: 116,
    MATOMO_TRACKER_URL: 'https://stats.data.gouv.fr/piwik.php',
    NODE_ENV: 'production',
    NOTIFICATIONS_AB_ENDPOINT: 'https://back.agencebio.org',
    NOTIFICATIONS_AB_ORIGIN: '',
    NOTIFICATIONS_AB_CARTOBIO_USER: null,
    NOTIFICATIONS_AB_CARTOBIO_PASSWORD: null,
    NOTIFICATIONS_AB_SSO_CLIENT_ID: null,
    NOTIFICATIONS_AB_SSO_CLIENT_SECRET: null,
    NOTIFICATIONS_AB_SSO_CALLBACK_URI: 'https://cartobio.agencebio.org/api/auth-provider/agencebio/callback',
    ...process.env,
    JWT_SECRET: process.env.CARTOBIO_JWT_SECRET ? Buffer.from(process.env.CARTOBIO_JWT_SECRET, 'base64') : null,
    version
  }
}

module.exports = { requiredEnv, env }
