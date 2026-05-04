const fs = require('fs')
const AdmZip = require('adm-zip')
const { getAllParcelles } = require('./utils-pdf')
const path = require('path')
const { fetchOperatorByNumeroBio } = require('./agence-bio.js')

const pool = require('../db.js')
const { AttestationsProductionsStatus, AttestationsProductionsType } = require('../enums')
const config = require('../config')
const { createPdfContent } = require('./generate-pdf-content')

/**
 *
 * @param {import('crypto').UUID} recordId
 * @param {AttestationsProductionsStatus} status
 * @param {AttestationsProductionsType} type
 * @param {string} path
 */
function updateAttestationsProductions (recordId, status, type, path = null) {
  return pool.query(
    `INSERT INTO attestations_productions (record_id, type, status, path)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (record_id, type)
    DO UPDATE SET status = $3, path = $4, updated_at = CURRENT_TIMESTAMP`,
    [recordId, type, status, path]
  )
}

/**
 *
 * @param {import('crypto').UUID} recordId
 * @param {AttestationsProductionsType} type
 */
async function getAttestationProduction (recordId, type) {
  const { rows } = await pool.query(
    `SELECT path FROM attestations_productions ap
    JOIN cartobio_operators co ON co.record_id = ap.record_id
    WHERE ap.record_id = $1
    AND ap.updated_at > co.updated_at
    AND ap.status = 'generated'
    AND ap.type = $2
    `, [recordId, type]
  )

  return rows && rows.length > 0 ? rows[0] : null
}

/**
 *
 * @param {string} numeroBio
 * @param {import('crypto').UUID} recordId
 * @param {boolean} force
 * @param {boolean} pac
 * @param {boolean} zip
 */
async function * generatePDF (numeroBio, recordId, force = false, pac = false, zip = false) {
  const PDF_TYPES = pac || zip ? [AttestationsProductionsType.PACDETAILS, AttestationsProductionsType.PACCOMPLET] : [AttestationsProductionsType.COMPLET]
  const needZip = zip
  let yieldCount = true
  if (force) {
    await Promise.all(
      PDF_TYPES.map((type) =>
        updateAttestationsProductions(recordId, AttestationsProductionsStatus.STARTED, type)
      )
    )
  } else {
    const attestationsProductions = await Promise.all(
      PDF_TYPES.map((type) => getAttestationProduction(recordId, type))
    )
    const validAttestations = attestationsProductions.filter(Boolean)

    if (validAttestations.length > 0) {
      try {
        yieldCount = false
        yield 0

        if (!needZip) {
          return fs.readFileSync(validAttestations[0].path, { encoding: 'base64' })
        }

        const zip = new AdmZip()

        validAttestations.forEach((p, index) => {
          let newName
          if (index === 0) newName = `'cartobio_liste_PAC_${currentOperator.annee_reference_controle}_${currentOperator.numeroBio}.pdf`
          else if (index === 1) newName = `cartobio_attestation_PAC_${currentOperator.annee_reference_controle}_${currentOperator.numeroBio}.pdf`
          else newName = `fichier_${index}.pdf`

          zip.addLocalFile(p.path, '', newName)
        })

        return zip.toBuffer().toString('base64')
      } catch (e) {
        console.error(e)
        await Promise.all(
          PDF_TYPES.map((type) =>
            updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR, type)
          )
        )
      }
    } else {
      await Promise.all(
        PDF_TYPES.map((type) =>
          updateAttestationsProductions(recordId, AttestationsProductionsStatus.STARTED, type)
        )
      )
    }
  }

  const dataCurrentOperator = await fetchOperatorByNumeroBio(numeroBio)

  const query = /* sql */
  `SELECT co.version_name,
   co.audit_date,
   co.annee_reference_controle,
   co.mixite,
   co.oc_label,
   co.certification_date_debut,
   co.certification_date_fin,
   (
     SELECT STRING_AGG(t.numero_pacage::text, ', ' ORDER BY t.numero_pacage)
     FROM (
       SELECT DISTINCT NULLIF(TRIM(cp.numero_pacage::text), '') AS numero_pacage
       FROM cartobio_parcelles cp
       WHERE cp.record_id = co.record_id
     ) t
   ) AS numeros_pacage
  FROM cartobio_operators co
  WHERE co.record_id = $1`

  const { rows } = await pool.query(query, [recordId])

  const { metadata, ...record } = rows[0]

  const currentOperator = {
    ...dataCurrentOperator,
    metadata,
    ...record
  }
  const parcelles = await getAllParcelles(recordId, pac || zip)

  if (parcelles.length === 0) {
    console.error(`Aucune parcelle trouvée pour l'opérateur ${recordId}`)
    await Promise.all(
      PDF_TYPES.map((type) =>
        updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR, type)
      )
    )
    throw new Error("Aucune parcelle, impossible de générer l'attestation de production")
  }

  if (parcelles.some((p) => {
    if (!Array.isArray(p.cultures) || p.cultures.length === 0) {
      return true
    }

    return !p.cultures.some((c) => !!c.CPF)
  })) {
    console.error(`Culture manquante pour l'opérateur ${recordId}`)
    await Promise.all(
      PDF_TYPES.map((type) =>
        updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR, type)
      )
    )
    throw new Error("Culture manquante, impossible de générer l'attestation de production")
  }

  if (parcelles.some(p =>
    !p?.name &&
    (p?.nbilot == null && p?.nbp == null)
  )) {
    console.error(`Nom manquant de parcelle pour l'opérateur ${recordId}`)
    await Promise.all(
      PDF_TYPES.map((type) =>
        updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR, type)
      )
    )
    throw new Error("Nom manquant de parcelle, impossible de générer l'attestation de production")
  }

  if (yieldCount) {
    yield parcelles.length
  }
  try {
    const pdfs = await createPdfContent(numeroBio, recordId, parcelles, currentOperator, (pac || needZip))
    const dir = config.get('attestationsProductions.directory')

    const savedPaths = []

    for (const [index, pdf] of Array.from(pdfs.entries())) {
      const filename = path.join(dir, `${recordId}_${pac ? 'PAC' : 'complet'}_${index}.pdf`)
      await fs.promises.writeFile(
        filename,
        await pdf.save()
      )
      savedPaths.push(path.resolve(filename))
    }
    await Promise.all(
      savedPaths.map((p, index) =>
        updateAttestationsProductions(recordId, AttestationsProductionsStatus.GENERATED, PDF_TYPES[index], p)
      )
    )

    if (!needZip) {
      return pdfs[0].saveAsBase64()
    }
    const zip = new AdmZip()
    savedPaths.forEach((p, index) => {
      let newName
      if (index === 0) newName = `'cartobio_liste_PAC_${currentOperator.annee_reference_controle}_${currentOperator.numeroBio}.pdf`
      else if (index === 1) newName = `cartobio_attestation_PAC_${currentOperator.annee_reference_controle}_${currentOperator.numeroBio}.pdf`
      else newName = `fichier_${index}.pdf`

      zip.addLocalFile(p, '', newName)
    })
    return zip.toBuffer().toString('base64')
  } catch (e) {
    await Promise.all(
      PDF_TYPES.map((type) =>
        updateAttestationsProductions(recordId, AttestationsProductionsStatus.ERROR, type)
      )
    )
    console.error(e)
    throw new Error("Une erreur s'est produite, impossible de générer l'attestation de production")
  }
}

module.exports = {
  generatePDF,
  getAttestationProduction
}
