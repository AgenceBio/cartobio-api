#!/usr/bin/env node

import cliProgress from 'cli-progress'
import xlsx from 'xlsx'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../src/database/database.js'
import { importPac } from '../src/database/schema/index.js'
import { findLastAuditedRecordId } from '../src/shared/parcellaires/parcellaires.repository.js'
import type { RecordInput } from '../src/shared/parcellaires/parcellaires.types.js'
import { fetchCustomersByOc } from '../src/clients/agence-bio.client.js'
import { createOrUpdateOperatorRecord } from '../src/shared/parcellaires/parcellaires.service.js'
import { hideImport } from '../src/modules/operators/operators.service.js'
import type { OrganismeCertificateur } from '@agencebio/cartobio-types'

const [, , xlsxPath, ocId] = process.argv

if (xlsxPath === undefined || ocId === undefined) {
  console.error('Usage: node create-parcellaire-import-pac-xlsx.js <XLSX> <OC_ID>')
  process.exit(1)
}

;(async (): Promise<void> => {
  const workbook = xlsx.readFile(xlsxPath)
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName === undefined ? undefined : workbook.Sheets[sheetName]
  if (!sheet) {
    console.error('Aucune feuille dans le fichier XLSX.')
    process.exit(1)
  }
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet)
  const codesBio = rows
    .map((r) => r['Code bio'])
    .filter(Boolean)
    .map(String)

  if (codesBio.length === 0) {
    console.error('Aucun "Code bio" trouvé dans le fichier XLSX.')
    process.exit(1)
  }

  const operators = await fetchCustomersByOc(+ocId)

  const [firstOperator] = operators
  if (!firstOperator) {
    console.warn("Aucun numerobio pour l'oc", ocId)
    process.exit(0)
  }
  const oc = firstOperator.organismeCertificateur as OrganismeCertificateur

  if (oc.id !== +ocId) {
    console.warn('Id invalide lors de la récupération des parcellaires', oc)
    process.exit(1)
  }

  const operatorBioNumbers = new Set(operators.map((o) => o.numeroBio.toString()))

  const validCodesBio = codesBio.filter((nb) => operatorBioNumbers.has(nb))
  const invalidCodesBio = codesBio.filter((nb) => !validCodesBio.includes(nb))

  if (validCodesBio.length > 0) {
    console.log('Nombre de codes bios importées : ', validCodesBio.length)
  }

  if (invalidCodesBio.length > 0) {
    console.warn('Codes bio ignorés (non trouvés chez cet OC):', invalidCodesBio.join(', '))
  }

  if (validCodesBio.length === 0) {
    console.error('Aucun code bio valide trouvé. Fin du script.')
    process.exit(0)
  }

  const parcellairesACreer = await db
    .select({ record: importPac.record, numerobio: sql<string>`${importPac.numeroBio}` })
    .from(importPac)
    .where(and(inArray(importPac.numeroBio, validCodesBio), eq(importPac.imported, false)))
  const numerobioACreer = parcellairesACreer.map((r) => r.numerobio)
  const parcellairesDejaImportes = validCodesBio.filter((nb) => !numerobioACreer.includes(nb))

  if (parcellairesDejaImportes.length > 0) {
    console.warn('Codes bio déjà importés :', parcellairesDejaImportes.join(', '))
  }

  const progress = new cliProgress.SingleBar({ etaBuffer: 10000 }, cliProgress.Presets.rect)
  progress.start(parcellairesACreer.length, 0)

  try {
    for (const parcelle of parcellairesACreer) {
      const previousRecordId = await findLastAuditedRecordId(parcelle.numerobio)

      const { id: ocIdNum, nom: ocLabel } = oc
      const record = await createOrUpdateOperatorRecord(
        { numerobio: parcelle.numerobio, oc_id: ocIdNum, oc_label: ocLabel, ...(parcelle.record as RecordInput) },
        {
          user: null,
          copyParcellesData: previousRecordId != null,
          previousRecordId: previousRecordId ?? undefined
        }
      )

      if (record.numerobio !== parcelle.numerobio) {
        console.error(
          "Erreur d'import pour le numéro: %s, résultat: numéro bio: %s, parcellaire: %s",
          parcelle.numerobio,
          record.numerobio,
          record.record_id
        )
        process.exit(1)
      }

      await hideImport(parcelle.numerobio)
      progress.increment()
    }
  } catch (error) {
    console.error(error)
    process.exit(1)
  } finally {
    progress.stop()
  }
})()
