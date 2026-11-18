#!/usr/bin/env node

import cliProgress from 'cli-progress'
import xlsx from 'xlsx'
import pool from '../src/database/database.js'
import { fetchCustomersByOc } from '../src/clients/agence-bio.client.js'
import { createOrUpdateOperatorRecord } from '../src/shared/parcellaires/parcellaires.service.js'
import { hideImport } from '../src/modules/operators/operators.service.js'
import type { OrganismeCertificateur } from '@agencebio/cartobio-types'

if (process.argv.length < 4) {
  console.error('Usage: node create-parcellaire-import-pac-xlsx.js <XLSX> <OC_ID>')
  process.exit(1)
}

(async (): Promise<void> => {
  const xlsxPath = process.argv[2]
  const ocId = process.argv[3]

  const workbook = xlsx.readFile(xlsxPath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet)
  const codesBio = rows
    .map(r => r['Code bio'])
    .filter(Boolean)
    .map(String)

  if (codesBio.length === 0) {
    console.error('Aucun "Code bio" trouvé dans le fichier XLSX.')
    process.exit(1)
  }

  const client = await pool.connect()
  const operators = await fetchCustomersByOc(+ocId)

  if (operators.length === 0) {
    console.warn("Aucun numerobio pour l'oc", ocId)
    process.exit(0)
  }

  const oc = operators[0].organismeCertificateur as OrganismeCertificateur

  if (oc.id !== +ocId) {
    console.warn('Id invalide lors de la récupération des parcellaires', oc)
    process.exit(1)
  }

  const operatorBioNumbers = new Set(operators.map(o => o.numeroBio.toString()))

  const validCodesBio = codesBio.filter(nb => operatorBioNumbers.has(nb))
  const invalidCodesBio = codesBio.filter(nb => !validCodesBio.includes(nb))

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

  const { rows: parcellairesACreer } = await pool.query(
    /* sql */ `
      SELECT
        ip.record,
        ip.numerobio
      FROM import_pac_26 ip
      WHERE ip.numerobio = ANY($1) AND ip.imported = false
    `,
  [validCodesBio]
  )
  const numerobioACreer = parcellairesACreer.map(r => r.numerobio)
  const parcellairesDejaImportes = validCodesBio.filter(nb => !numerobioACreer.includes(nb))

  if (parcellairesDejaImportes.length > 0) {
    console.warn('Codes bio déjà importés :', parcellairesDejaImportes.join(', '))
  }

  const progress = new cliProgress.SingleBar({ etaBuffer: 10000 }, cliProgress.Presets.rect)
  progress.start(parcellairesACreer.length, 0)

  try {
    for (const parcelle of parcellairesACreer) {
      const { rows } = await pool.query(
        /* sql */ `
          SELECT co.record_id
          FROM cartobio_operators co
          WHERE co.certification_state IN ('CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION')
            AND numerobio = $1
          ORDER BY certification_state = 'CERTIFIED' DESC, audit_date DESC
          LIMIT 1
        `,
  [parcelle.numerobio]
      )

      const previousParcellaire = rows.length > 0 ? rows[0] : null

      const { id: ocIdNum, nom: ocLabel } = oc
      const record = await createOrUpdateOperatorRecord(
        { numerobio: parcelle.numerobio, oc_id: ocIdNum, oc_label: ocLabel, ...parcelle.record },
        {
          user: null,
          copyParcellesData: previousParcellaire != null,
          previousRecordId: previousParcellaire ? previousParcellaire.record_id : null
        },
        client
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
    client.release()
    progress.stop()
  }
})()
