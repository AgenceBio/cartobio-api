#!/usr/bin/env node

const fs = require('fs')
const cliProgress = require('cli-progress')

const pool = require('../lib/db')
const { fetchCustomersByOc } = require('../lib/providers/agence-bio.js')
const { createOrUpdateOperatorRecord, hideImport } = require('../lib/providers/cartobio.js')
/* main.js */

if (process.argv.length < 3) {
  console.error(
    'Usage: node create-parcellaire-import-pac-for-oc.js <OC_ID>'
  )
  process.exit(1)
}

(async () => {
  const ocId = process.argv[2]

  const client = await pool.connect()
  const operators = await fetchCustomersByOc(ocId)
  console.log('Nombre d\'opérateurs retournés par l\'api: %d', operators.length)
  if (operators.length === 0) {
    console.warn('Aucun numerobio pour l\'oc', ocId)
    process.exit(0)
  }

  const operatorsEngages = operators.filter((o) => {
    const notification = o.notifications
    return notification.etatCertification === 'ENGAGEE' && notification.organismeCertificateurId === +ocId
  })

  const oc = operatorsEngages[0].organismeCertificateur

  console.log('Nombre d\'opérateurs ENGAGE pour cet OC: %d', operatorsEngages.length)

  fs.writeFileSync('./numeros-bios-engages.txt', JSON.stringify(operatorsEngages.map((o) => o.numeroBio)))

  const { rows: parcellairesACreer } = await pool.query(
    /* sql */ `
    SELECT
    ip.record,
    ip.numerobio
    FROM import_pac_26 ip
    WHERE ip.numerobio = ANY($1) AND ip.imported = false
        `,
  [operatorsEngages.map((o) => o.numeroBio.toString())]
  )

  const progress = new cliProgress.SingleBar(
    {},
    { ...cliProgress.Presets.rect, etaBuffer: 10000 }
  )
  progress.start(parcellairesACreer.length, 0)
  let nbImportes = 0
  try {
    for (const parcelle of parcellairesACreer) {
      const { rows } = await pool.query(
        /* sql */ `
      SELECT
        co.record_id
      FROM
        cartobio_operators co
      WHERE
        co.certification_state IN ('CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION')
        AND numerobio = $1
      ORDER BY
        certification_state = 'CERTIFIED' DESC, audit_date DESC
      LIMIT 1
            `,
  [parcelle.numerobio]
      )

      const previousParcellaire = rows.length > 0 ? rows[0] : null

      const { id: ocId, nom: ocLabel } = oc
      const record = await createOrUpdateOperatorRecord(
        { numerobio: parcelle.numerobio, oc_id: ocId, oc_label: ocLabel, ...parcelle.record },
        { user: null, copyParcellesData: previousParcellaire != null, previousRecordId: previousParcellaire ? previousParcellaire.record_id : null },
        client)

      if (record.numerobio !== parcelle.numerobio) {
        console.error("Une erreur s'est produite pour l'import du numéro: %s, résultat: numéro bio: %s, parcellaire; %s ", parcelle.numerobio, record.numerobio, record.record_id)
        process.exit(0)
      }

      await hideImport(parcelle.numerobio)
      nbImportes++
      progress.increment()
    }
  } catch (error) {
    console.error(error)
    process.exit(1)
  } finally {
    client.release()
    progress.stop()
    console.log('Nombre de parcellaires réellement importés: %d', nbImportes)
  }
})()
