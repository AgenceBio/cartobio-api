'use strict'

/**
 * Always return a 9 digits PACAGE identifier
 * @param  {undefined|null|String|Integer} numeroPacage [description]
 * @return {String|null}              [description]
 */
function format (numeroPacage) {
  return numeroPacage ? String(numeroPacage).padStart(9, '0') : null
}

module.exports = { format }
