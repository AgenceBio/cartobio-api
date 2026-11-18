#!/usr/bin/env node

import pool from '../src/database/database.js'
import { withTransaction } from '../src/database/transaction.js'

/**
 * Script de nettoyage des parcellaires supprimés depuis plus de 6 mois
 */
async function clearRecords (): Promise<void> {
  if (process.argv[2] === '-h' || process.argv[2] === '--help') {
    console.log(
      'Usage: node clean-records.js (-h|--help|--dry-run)+'
    )
    process.exit(0)
  }
  const dryRun = process.argv[2] === '--dry-run'

  try {
    const countDeletedRecords = await withTransaction(async (client): Promise<number> => {
      const queryRes = await client.query(
        /* sql */`
          SELECT count(record.record_id)::int as count
          FROM cartobio_operators record
          WHERE record.deleted_at IS NOT NULL
            AND record.deleted_at < (NOW() - interval ' 6 months')
          `
      )

      const countRecords: number = queryRes.rows[0].count

      if (countRecords === 0) {
        console.log('Aucun parcellaire a supprimer')
        return 0
      }

      console.log(countRecords, 'parcellaires vont être supprimés')
      if (dryRun) {
        console.log('Flag --dry-run, aucune suppression effectuée')
        return 0
      }

      const deleteRes = await client.query(
        /* sql */`
          DELETE
          FROM cartobio_operators record
          WHERE record.deleted_at IS NOT NULL
            AND record.deleted_at < (NOW() - interval ' 6 months')
          `
      )

      return deleteRes.rowCount ?? 0
    })

    console.log(countDeletedRecords, 'parcellaires supprimés')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

(async function (): Promise<void> {
  await clearRecords()
})()
