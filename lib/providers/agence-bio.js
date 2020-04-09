'use strict'

const memo = require('p-memoize')
const { get, post } = require('got')
const { format: formatPacage } = require('../pacage.js')

const {
  NOTIFICATIONS_AB_ENDPOINT,
  NOTIFICATIONS_AB_CARTOBIO_USER,
  NOTIFICATIONS_AB_CARTOBIO_PASSWORD
} = require('../app.js').env()

const ONE_HOUR = 60 * 60 * 1000
const ONE_MINUTE = 60 * 1000

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
const auth = memo(() => fetchAuthToken({
  email: NOTIFICATIONS_AB_CARTOBIO_USER,
  motDePasse: NOTIFICATIONS_AB_CARTOBIO_PASSWORD
}), { maxAge: 6 * ONE_HOUR })

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

module.exports = {
  fetchCustomersByOperator: memo(fetchCustomersByOperator, { maxAge: 20 * ONE_MINUTE })
}
