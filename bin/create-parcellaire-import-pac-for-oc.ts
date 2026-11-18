#!/usr/bin/env node

import fs from 'node:fs'
import cliProgress from 'cli-progress'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../src/database/database.js'
import { scriptOutputPath } from '../src/shared/paths.js'
import { importPac } from '../src/database/schema/index.js'
import { findLastAuditedRecordId } from '../src/shared/parcellaires/parcellaires.repository.js'
import type { RecordInput } from '../src/shared/parcellaires/parcellaires.types.js'
import { fetchCustomersByOc } from '../src/clients/agence-bio.client.js'
import { createOrUpdateOperatorRecord } from '../src/shared/parcellaires/parcellaires.service.js'
import { hideImport } from '../src/modules/operators/operators.service.js'
import type { OrganismeCertificateur } from '@agencebio/cartobio-types'

const [, , ocId] = process.argv

if (ocId === undefined) {
  console.error('Usage: npm run job:parcellaire-pac-oc -- <OC_ID>')
  process.exit(1)
}

const operators = await fetchCustomersByOc(+ocId)
console.log("Nombre d'opérateurs retournés par l'api: %d", operators.length)
if (operators.length === 0) {
  console.warn("Aucun numerobio pour l'oc", ocId)
  process.exit(0)
}

const operatorsEngages = operators.filter((o) => {
  const notification = o.notifications
  return notification.etatCertification === 'ENGAGEE' && notification.organismeCertificateurId === +ocId
})

const [firstOperatorEngage] = operatorsEngages
if (!firstOperatorEngage) {
  console.warn("Aucun opérateur ENGAGE pour l'oc", ocId)
  process.exit(0)
}
const oc = firstOperatorEngage.organismeCertificateur as OrganismeCertificateur

console.log("Nombre d'opérateurs ENGAGE pour cet OC: %d", operatorsEngages.length)

fs.writeFileSync(
  scriptOutputPath('numeros-bios-engages.txt'),
  JSON.stringify(operatorsEngages.map((o) => o.numeroBio)),
  { mode: 0o600 }
)

const progress = new cliProgress.SingleBar({ etaBuffer: 10000 }, cliProgress.Presets.rect)
let nbImportes = 0
try {
  const parcellairesACreer = await db
    .select({ record: importPac.record, numerobio: sql<string>`${importPac.numeroBio}` })
    .from(importPac)
    .where(
      and(
        inArray(
          importPac.numeroBio,
          operatorsEngages.map((o) => o.numeroBio.toString())
        ),
        eq(importPac.imported, false)
      )
    )

  progress.start(parcellairesACreer.length, 0)
  for (const parcelle of parcellairesACreer) {
    const previousRecordId = await findLastAuditedRecordId(parcelle.numerobio)

    const { id: ocId, nom: ocLabel } = oc
    const record = await createOrUpdateOperatorRecord(
      { numerobio: parcelle.numerobio, oc_id: ocId, oc_label: ocLabel, ...(parcelle.record as RecordInput) },
      { user: null, copyParcellesData: previousRecordId != null, previousRecordId: previousRecordId ?? undefined }
    )

    if (record.numerobio !== parcelle.numerobio) {
      console.error(
        "Une erreur s'est produite pour l'import du numéro: %s, résultat: numéro bio: %s, parcellaire; %s ",
        parcelle.numerobio,
        record.numerobio,
        record.record_id
      )
      process.exitCode = 1
      break
    }

    await hideImport(parcelle.numerobio)
    nbImportes++
    progress.increment()
  }
} finally {
  progress.stop()
  console.log('Nombre de parcellaires réellement importés: %d', nbImportes)
  await db.$client.end()
}
