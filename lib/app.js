'use strict'

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
    MATOMO_SITE_ID: 116,
    MATOMO_TRACKER_URL: 'https://stats.data.gouv.fr/piwik.php',
    NODE_ENV: 'production',
    ESPACE_COLLABORATIF_ENDPOINT: 'https://espacecollaboratif.ign.fr',
    NOTIFICATIONS_AB_ENDPOINT: 'https://back.agencebio.org',
    ESPACE_COLLABORATIF_BASIC_AUTH: null,
    NOTIFICATIONS_AB_ORIGIN: '',
    NOTIFICATIONS_AB_CARTOBIO_USER: null,
    NOTIFICATIONS_AB_CARTOBIO_PASSWORD: null,
    NOTIFICATIONS_AB_SSO_CLIENT_ID: null,
    NOTIFICATIONS_AB_SSO_CLIENT_SECRET: null,
    NOTIFICATIONS_AB_SSO_CALLBACK_URI: 'https://cartobio.agencebio.org/api/auth-provider/agencebio/callback',
    ...process.env
  }
}

module.exports = { requiredEnv, env }
