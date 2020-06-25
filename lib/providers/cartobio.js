'use strict'

const pool = require('../db.js')
const { fetchCustomersByOperator } = require('./agence-bio.js')

/**
 * Patch
 * @param  {[type]} numeroBio [description]
 * @param  {[type]} data      [description]
 * @return {Promise} PGPromise
 */
async function updateOperator ({ ocId, numeroBio }, data) {
  const [operator, result] = await Promise.all([
    fetchCustomersByOperator({ ocId, numeroBio }).then(all => all[0]),
    pool.query('SELECT numerobio, metadata FROM cartobio_operators WHERE numerobio = $1 LIMIT 1', [numeroBio])
  ])

  if (!operator) {
    throw new Error(`Operator ${numeroBio} is not managed by ${ocId}, cannot continue.`)
  }

  const recordAlreadyExists = Boolean(result.rows.length)
  const mergedData = {
    ...(recordAlreadyExists ? result.rows[0].metadata : {}),
    ...data
  }

  // updatedData[value] = mergedData[key] === 'none' ? '' : mergedData[key]
  if (!recordAlreadyExists) {
    await pool.query('INSERT INTO cartobio_operators (numerobio, metadata) VALUES ($1, $2)', [numeroBio, mergedData])
  } else {
    await pool.query('UPDATE cartobio_operators set metadata = $2 WHERE numerobio = $1', [numeroBio, mergedData])
  }

  // Postgres 9.5+
  // await pool.query(`INSERT INTO cartobio_operators (numerobio, metadata) VALUES ($1, $2)
  //                    ON CONFLICT ON CONSTRAINT cartobio_operators_pkey
  //                    DO UPDATE SET pacage = $2`, [numeroBio, mergedData])

  return mergedData
}

module.exports = {
  updateOperator
}
