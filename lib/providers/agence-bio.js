'use strict'

const { get, post } = require('got')
const { format: formatPacage } = require('../pacage.js')

const {
  NOTIFICATIONS_AB_ENDPOINT,
  NOTIFICATIONS_AB_CARTOBIO_USER,
  NOTIFICATIONS_AB_CARTOBIO_PASSWORD
} = require('../app.js').env()

/**
 * Pick only the relevant fields
 *
 * @param  {Integer} numeroBio    [description]
 * @param  {String} numeroPacage [description]
 * @return {Object<numeroBio,numeroPacage>}
 */
function mapCustomersToIdentifiers ({ numeroBio, numeroPacage }) {
  return { numeroBio, numeroPacage: formatPacage(numeroPacage) }
}

/**
 * Authenticate a user based on environemnt variables
 * It is a good idea to memoize it for a few hours to save on API calls
 *
 * @return {String}            A JWT Auth Token
 */
const auth = () => fetchAuthToken({
  email: NOTIFICATIONS_AB_CARTOBIO_USER,
  motDePasse: NOTIFICATIONS_AB_CARTOBIO_PASSWORD
})

/**
 * [fetchAuthToken description]
 * @param  {String} email      [description]
 * @param  {String} motDePasse [description]
 * @return {String}            A JWT Auth Token
 */
function fetchAuthToken ({ email, motDePasse }) {
  return post(`${NOTIFICATIONS_AB_ENDPOINT}/api/auth/login`, {
    json: { email, motDePasse }
  })
    .json()
    .then(({ token }) => token)
}

/**
 * [fetchCustomersByOperator description]
 * @param  {[type]} ocId [description]
 * @return {[type]}      [description]
 */
async function fetchCustomersByOperator (ocId) {
  const token = await auth()

  return get(`${NOTIFICATIONS_AB_ENDPOINT}/api/getOperatorsByOc`, {
    searchParams: { oc: ocId },
    headers: { Authorization: `Bearer ${token}` }
  })
    .json()
    .then((operators) => operators.map(mapCustomersToIdentifiers))
}

module.exports = { fetchCustomersByOperator }
