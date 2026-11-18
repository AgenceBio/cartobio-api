#!/usr/bin/env node

import { and, count, isNotNull, lt, sql } from 'drizzle-orm'
import { db, firstRow } from '../src/database/database.js'
import { parcellaires, revokedTokens } from '../src/database/schema/index.js'

/**
 * Script de nettoyage des parcellaires supprimés depuis plus de 6 mois
 */
async function clearRecords(): Promise<void> {
  if (process.argv[2] === '-h' || process.argv[2] === '--help') {
    console.log('Usage: node clean-records.js (-h|--help|--dry-run)+')
    process.exit(0)
  }
  const dryRun = process.argv[2] === '--dry-run'
  const expiredRecords = and(
    isNotNull(parcellaires.deletedAt),
    lt(parcellaires.deletedAt, sql`NOW() - interval '6 months'`)
  )

  try {
    const countDeletedRecords = await db.transaction(async (tx): Promise<number> => {
      const { count: countRecords } = firstRow(
        await tx
          .select({ count: count(parcellaires.recordId) })
          .from(parcellaires)
          .where(expiredRecords)
      )

      if (countRecords === 0) {
        console.log('Aucun parcellaire a supprimer')
        return 0
      }

      console.log(countRecords, 'parcellaires vont être supprimés')
      if (dryRun) {
        console.log('Flag --dry-run, aucune suppression effectuée')
        return 0
      }

      const deleteRes = await tx.delete(parcellaires).where(expiredRecords)

      return deleteRes.rowCount ?? 0
    })

    console.log(countDeletedRecords, 'parcellaires supprimés')

    if (!dryRun) {
      const { rowCount } = await db.delete(revokedTokens).where(lt(revokedTokens.expiresAt, sql`NOW()`))
      console.log(rowCount, 'jetons révoqués expirés supprimés')
    }
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await db.$client.end()
  }
}

;(async function (): Promise<void> {
  await clearRecords()
})()
