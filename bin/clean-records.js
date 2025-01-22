#!/usr/bin/env node

const pool = require('../lib/db')

/**
 * Script de nettoyage des parcellaires supprimés depuis plus de 6 mois
 */
async function exit (client, code) {
  await client.release()
  process.exit(code)
}
async function clearRecords () {
  if (process.argv[2] === '-h' || process.argv[2] === '--help') {
    console.log(
      'Usage: node clean-records.js (-h|--help|--dry-run)+'
    )
    process.exit(0)
  }
  const dryRun = process.argv[2] === '--dry-run'
  let countRecords = 0
  let countDeletedRecords = 0
  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    const queryRes = await client.query(
      /* sql */`
        SELECT count(record.record_id)::int as count
        FROM cartobio_operators record
        WHERE record.deleted_at IS NOT NULL
          AND record.deleted_at < (NOW() - interval ' 6 months')
        `
    )

    countRecords = queryRes.rows[0].count

    if (countRecords === 0) {
      console.log('Aucun parcellaire a supprimer')
      await exit(client, 0)
    }

    console.log(countRecords, 'parcellaires vont être supprimés')
    if (dryRun) {
      console.log('Flag --dry-run, aucune suppression effectuée')
      await exit(client, 0)
    }

    countDeletedRecords = (await client.query(
      /* sql */`
        DELETE
        FROM cartobio_operators record
        WHERE record.deleted_at IS NOT NULL
          AND record.deleted_at < (NOW() - interval ' 6 months')
        `
    )).rowCount
  } catch (error) {
    await client.query('ROLLBACK;')
    console.error(error)
    await exit(client, 1)
  } finally {
    console.log(countDeletedRecords, 'parcellaires supprimés')

    await client.query('COMMIT;')
    await client.release()
  }
}

(async function () {
  await clearRecords()
})()
