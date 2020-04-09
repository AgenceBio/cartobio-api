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
    MATOMO_SITE_ID: 116,
    MATOMO_TRACKER_URL: 'https://stats.data.gouv.fr/piwik.php',
    NODE_ENV: 'dev',
    ESPACE_COLLABORATIF_ENDPOINT: 'https://espacecollaboratif.ign.fr',
    NOTIFICATIONS_AB_ENDPOINT: 'https://back.agencebio.org',
    ESPACE_COLLABORATIF_BASIC_AUTH: null,
    NOTIFICATIONS_AB_CARTOBIO_USER: null,
    NOTIFICATIONS_AB_CARTOBIO_PASSWORD: null,
    ...process.env
  }
}

module.exports = { requiredEnv, env }