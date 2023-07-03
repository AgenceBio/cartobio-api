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

  for await (const { geojson, ocId, ocLabel, numeroBio } of generator) {
    const { id: operatorId } = await fetchOperatorByNumeroBio(numeroBio)
    const metadata = { source: 'API', sourceLastUpdate: new Date().toISOString() }

    /* eslint-disable-next-line camelcase */
    const { record_id } = await updateOperatorParcels({ operatorId }, { geojson, ocId, ocLabel, numeroBio, metadata })
    await updateAuditRecordState(record_id, { certification_state: 'CERTIFIED' })
  }

  client.release(true)
})
