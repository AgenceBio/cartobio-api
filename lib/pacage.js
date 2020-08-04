'use strict'

/**
 * Always return a 9 digits PACAGE identifier
 * @param  {undefined|null|String|Integer} numeroPacage [description]
 * @returns {String|null}              [description]
 */
function format (numeroPacage) {
  return numeroPacage ? String(numeroPacage).padStart(9, '0') : null
}

/**
 * Removes the leading zero of Pacage
 * Mostly to pipe it back into agencebio API
 *
 * @param {string} numeroPacage
 * @returns {string}
 */
function unPrefix (numeroPacage) {
  return numeroPacage[0] === '0' ? numeroPacage.slice(1) : numeroPacage
}

module.exports = { format, unPrefix }
