'use strict'

/**
 * Always returns a 9 digits PACAGE identifier
 * @param {null|String|Integer} [numeroPacage]
 * @returns {String|null}
 */
function format (numeroPacage) {
  return numeroPacage ? String(numeroPacage).padStart(9, '0') : null
}

module.exports = { format }
