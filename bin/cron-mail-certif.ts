#!/usr/bin/env node

import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../src/database/database.js'
import { parcellaires as parcellairesTable } from '../src/database/schema/index.js'
import { certificationEtatEnumSchema } from '../src/database/validations/parcellaires.js'
import { markCertificationNotified } from '../src/shared/parcellaires/parcellaires.repository.js'
import { recordColumns } from '../src/shared/parcellaires/parcellaires.utils.js'
import { sendCertificationCompleteModifie } from '../src/services/mailer/utils.js'
import { fetchEmailForNumeroBio } from '../src/clients/agence-bio.client.js'

async function sendMail(): Promise<void> {
  try {
    const parcellaires = await db
      .select({
        record_id: recordColumns.record_id,
        updated_at: parcellairesTable.updatedAt,
        annee_reference_controle: recordColumns.annee_reference_controle,
        numerobio: recordColumns.numerobio,
        version_name: recordColumns.version_name
      })
      .from(parcellairesTable)
      .where(
        and(
          eq(parcellairesTable.certificationEtat, certificationEtatEnumSchema.enum.CERTIFIED),
          or(
            gt(parcellairesTable.updatedAt, parcellairesTable.dateDerniereNotif),
            and(
              isNull(parcellairesTable.dateDerniereNotif),
              gt(parcellairesTable.updatedAt, sql`now() - interval '7 days'`)
            )
          ),
          isNull(parcellairesTable.deletedAt)
        )
      )

    let errors = 0
    for (const parcellaire of parcellaires) {
      try {
        const emails = await fetchEmailForNumeroBio(parcellaire.numerobio)

        for (const utilisateur of emails.utilisateurs) {
          await sendCertificationCompleteModifie(parcellaire, utilisateur.email)
        }

        await markCertificationNotified(db, parcellaire.record_id)
      } catch (err) {
        errors++
        console.error(`Erreur envoi notification pour le parcellaire ${parcellaire.record_id}:`, err)
      }
    }

    process.exit(errors > 0 ? 1 : 0)
  } catch (err) {
    console.error('Erreur envoi notification:', err)
    process.exit(1)
  }
}

;(async function (): Promise<void> {
  await sendMail()
})()
