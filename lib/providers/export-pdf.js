const fs = require('fs')
const { getAllParcelles } = require('./utils-pdf')
const path = require('path')
const { fetchOperatorByNumeroBio } = require('./agence-bio.js')

const pool = require('../db.js')
const { AttestationsProductionsStatus } = require('../enums')
const config = require('../config')
const { createPdfContent } = require('./generate-pdf-content')

/**
 *
 * @param {import('crypto').UUID} recordId
 * @param {AttestationsProductionsStatus} status
 * @param {string} path
 */
function updateAttestationsProductions (recordId, status, path = null) {
  return pool
    .query(
    `INSERT INTO attestations_productions (record_id, status, path) 
    VALUES ($1, $2, $3)
    ON CONFLICT (record_id)
    DO UPDATE SET status = $2, path = $3, updated_at = CURRENT_TIMESTAMP`,
    [recordId, status, path])
}

/**
 *
 * @param {import('crypto').UUID} recordId
 */
async function getAttestationProduction (recordId) {
  const { rows } = await pool.query(
    `SELECT path FROM attestations_productions ap
    JOIN cartobio_operators co ON co.record_id = ap.record_id
    WHERE ap.record_id = $1
    AND ap.updated_at > co.updated_at
    AND ap.status = 'generated'
    `, [recordId]
  )

  return rows && rows.length > 0 ? rows[0] : null
}

/**
 *
 * @param {string} numeroBio
 * @param {import('crypto').UUID} recordId
 * @param {boolean} force
 */
async function generatePDF (numeroBio, recordId, force = false) {
  if (force) {
    await updateAttestationsProductions(recordId, AttestationsProductionsStatus.STARTED)
  } else {
    const attestationProduction = await getAttestationProduction(recordId)

    if (attestationProduction) {
      try {
        return fs.readFileSync(attestationProduction.path, { encoding: 'base64' })
      } catch (e) {
        console.error(e)
        await updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR)
      }
    } else {
      await updateAttestationsProductions(recordId, AttestationsProductionsStatus.STARTED)
    }
  }

  const dataCurrentOperator = await fetchOperatorByNumeroBio(numeroBio)
  const { rows } = await pool
    .query(/* sql */`SELECT version_name, audit_date, annee_reference_controle, mixite,oc_label
        FROM cartobio_operators
        WHERE record_id = $1`,
    [recordId])

  const { metadata, ...record } = rows[0]

  const currentOperator = {
    ...dataCurrentOperator,
    metadata,
    ...record
  }
  const parcelles = await getAllParcelles(recordId)

  if (parcelles.length === 0) {
    console.error(`Aucune parcelle trouvée pour l'opérateur ${recordId}`)
    await updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR)
    return { global: null, parcelles: [] }
  }

  try {
    const pdf = await createPdfContent(numeroBio, recordId, parcelles, currentOperator)
    console.log(pdf)
    const dir = config.get('attestationsProductions.directory')

    const filename = path.join(dir, `${recordId}.pdf`)
    fs.writeFile(
      filename,
      await pdf.save(),
      'utf8',
      (err) => {
        if (err) {
          console.error(err)
        }
      }
    )

    await updateAttestationsProductions(recordId, AttestationsProductionsStatus.GENERATED, path.resolve(filename))
    return pdf.saveAsBase64()
  } catch (e) {
    await updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR)
    console.error(e)
    throw new Error("Une erreur s'est produite, impossible de générer l'attestation de production")
  }
}

module.exports = {
  generatePDF,
  getAttestationProduction
}
