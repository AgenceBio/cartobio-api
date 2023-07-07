#!/usr/bin/env node

const { createReadStream } = require('node:fs')
const { parseArgs } = require('node:util')
const stripBom = require('strip-bom-stream')
const db = require('../lib/db.js')
const { auth, fetchCertificationBody, fetchOperatorByNumeroBio, parseAPIParcellaireStream } = require('../lib/providers/agence-bio.js')
const { updateOperatorParcels, updateAuditRecordState } = require('../lib/providers/cartobio.js')

const CLI_OPTIONS = {
  file: {
    type: 'string'
  },
  ocId: {
    type: 'string'
  }
}

db.connect().then(async (client) => {
  const token = await auth()
  const OCs = await fetchCertificationBody(token)

  const { values } = parseArgs({ options: CLI_OPTIONS })

  const organismeCertificateur = OCs.find(({ id }) => String(id) === values.ocId)
  const stream = createReadStream(values.file).pipe(stripBom())
  const generator = parseAPIParcellaireStream(stream, { organismeCertificateur })
  let count = 0

  for await (const { geojson, ocId, ocLabel, numeroBio } of generator) {
    process.stdout.write(`#${++count} Import n°bio : ${numeroBio}`)

    try {
      const { id: operatorId } = await fetchOperatorByNumeroBio(numeroBio)
      process.stdout.write(`, ID #${operatorId}`)

      const metadata = { source: 'API Parcellaire', sourceLastUpdate: new Date().toISOString() }
      const historyEvent = {
        state: 'CERTIFIED',
        date: new Date().toISOString(),
        provenance: 'API Parcellaire'
      }

      try {
        await updateOperatorParcels({ operatorId }, { geojson, ocId, ocLabel, numeroBio, metadata, historyEvent })
      } catch (error) {
        console.error(error)
        process.exit(1)
      }
    } catch (error) {
      process.stdout.write(', ID introuvable [SKIP]')
    }

    process.stdout.write('\n')
  }

  client.release(true)
})
