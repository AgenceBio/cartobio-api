
'use strict'

const { feature, featureCollection, polygon } = require('@turf/helpers')
const JSONStream = require('jsonstream-next')
const pool = require('../db.js')
const { EtatProduction, CertificationState, RegionBounds } = require('../enums')
const { parsePacDetailsFromComment, fetchOperatorByNumeroBio } = require('./agence-bio.js')
const { normalizeEtatProduction } = require('../outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodeCpf } = require('@agencebio/rosetta-cultures')
// @ts-ignore
const { InvalidRequestApiError } = require('../errors.js')
const { getRandomFeatureId } = require('../outputs/features.js')
const bboxPolygon = require('@turf/bbox-polygon').default
const polygonInPolygon = require('@turf/boolean-intersects').default

const { createOrUpdateOperatorRecord } = require('./cartobio.js')

/**
 * @typedef {import('geojson').Feature} Feature
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').GeoJsonProperties} FeatureProperties
 * @typedef {import('geojson').Polygon} Polygon
 * @typedef {import('./types/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('./types/cartobio').DBOperatorRecord} DBOperatorRecord
 * @typedef {import('./types/cartobio').DBOperatorRecordWithParcelles} DBOperatorRecordWithParcelles
 * @typedef {import('./types/cartobio').DBParcelle} DBParcelle
 * @typedef {import('./types/cartobio').OperatorFilter} OperatorFilter
 * @typedef {import('./types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('../outputs/types/api').InputApiRecord} InputApiRecord
 * @typedef {import('../outputs/types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('../outputs/types/features').CartoBioFeatureCollection} CartoBioFeatureCollection
 * @typedef {import('../outputs/types/features').CartoBioFeatureProperties} CartoBioFeatureProperties
 * @typedef {import('../outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('../outputs/types/record').NormalizedRecordSummary} NormalizedRecordSummary
 * @typedef {import('../outputs/types/history').HistoryEntry} HistoryEntry
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */

/**
 * @generator
 * @param {any} stream - a Json Stream
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @yields {{ record: Partial<NormalizedRecord>, error: Error?, warnings: Array<{numeroBio: String, message: String}> }}
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  /**
   * @type {Promise<InputApiRecord>[]}
   */
  const streamRecords = stream
  const warnings = []

  for await (const record of streamRecords) {
    const operator = await fetchOperator(String(record.numeroBio))
    console.log(operator)

    if (operator == null) {
      yield ({ numeroBio: String(record.numeroBio), error: new Error('Numéro bio inconnu du portail de notification') })
      continue
    } else if (!operator.isProduction) {
      yield ({ numeroBio: String(record.numeroBio), error: new Error('Numéro bio sans notification liée à une activité de production') })
      continue
    }

    if (operator.organismeCertificateur.numeroClient !== String(record.numeroClient)) {
      yield ({ numeroBio: String(record.numeroBio), error: new Error('Numéro client différent -> numéro attendu  : ' + operator.organismeCertificateur.numeroClient) })
    }

    if (record.dateCertificationDebut && isNaN(Date.parse(record.dateCertificationDebut))) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateCertificationDebut incorrect') }
      continue
    }

    if (record.dateCertificationFin && isNaN(Date.parse(record.dateCertificationFin))) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateCertificationFin incorrect') }
      continue
    }

    if (isNaN(Date.parse(record.dateAudit))) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateAudit incorrect') }
      continue
    }

    let hasFeatureError = null

    const features = await Promise.all(record.parcelles
      // turn products into features
      .map(async (parcelle) => {
        const id = !Number.isNaN(parseInt(String(parcelle.id), 10)) ? parseInt(String(parcelle.id), 10) % Number.MAX_SAFE_INTEGER : getRandomFeatureId()
        const cultures = parcelle.culture ?? parcelle.cultures
        const pac = parsePacDetailsFromComment(parcelle.commentaire)
        const numeroIlot = parseInt(String(parcelle.numeroIlot), 10)
        const numeroParcelle = parseInt(String(parcelle.numeroParcelle), 10)
        let conversionNiveau
        try {
          conversionNiveau = parcelle.etatProduction && normalizeEtatProduction(parcelle.etatProduction, { strict: true })
          // Il faut que la date d'engagement soit obligatoire pour les parcelles en C1, C2 ou C3. (Donc différent de AB et CONV)
          if (conversionNiveau !== null && [EtatProduction.C1, EtatProduction.C2, EtatProduction.C3].includes(conversionNiveau) && !Date.parse(parcelle.dateEngagement)) {
            hasFeatureError = new Error('Champ date dengagement obligatoire lorsque que la parcelle est en conversion')
            return null
          }
        } catch (error) {
          hasFeatureError = new Error('champ etatProduction incorrect')
          return null
        }
        const properties = {
          id,
          cultures: cultures?.map(({ codeCPF, quantite, variete = '', dateSemis = '', unite }) => ({
            id: randomUUID(),
            CPF: codeCPF,
            date_semis: dateSemis,
            surface: parseFloat(String(quantite)),
            unit: unite,
            variete
          })),
          NUMERO_I: Number.isNaN(numeroIlot) ? (pac ? pac.numeroIlot ?? null : null) : String(numeroIlot),
          NUMERO_P: Number.isNaN(numeroParcelle) ? (pac ? pac.numeroParcelle ?? null : null) : String(numeroParcelle),
          PACAGE: record.numeroPacage ? String(record.numeroPacage) : null,
          conversion_niveau: conversionNiveau,
          engagement_date: parcelle.dateEngagement ?? null,
          auditeur_notes: parcelle.commentaire ?? null,
          TYPE: parcelle.codeCulture ?? null,
          CODE_VAR: parcelle.codePrecision ?? null
        }

        if (parcelle.dateEngagement && !Date.parse(parcelle.dateEngagement)) {
          hasFeatureError = new Error('champ dateEngagement incorrect')
          return null
        }
        if (
          !cultures?.length
        ) {
          hasFeatureError = new Error('cultures absentes')
          return null
        }

        const invalidCodes = cultures
          .filter(c => !fromCodeCpf(c.codeCPF))
          .map(c => c.codeCPF)

        if (invalidCodes.length > 0) {
          hasFeatureError = new Error(`cultures inconnues: ${invalidCodes.join(', ')}`)
          return null
        }

        let coordinates = []

        if (parcelle.geom === null || parcelle.geom === undefined || parcelle.geom === '' || parcelle.geom === 'null') {
          warnings.push({ numeroBio: String(record.numeroBio), message: `Parcelle ${id ?? ''} n'a pas de géométrie` })
          return feature(null, properties, { id })
        }

        try {
          coordinates = JSON.parse(parcelle.geom.replace(/}$/, ''))
          coordinates.forEach(ring => ring.forEach(([x, y]) => {
            if (y > 90 || y < -90) {
              throw new Error('la latitude doit être comprise entre 90 et -90')
            }

            if (x > 180 || x < -180) {
              throw new Error('la longitude doit être comprise entre 180 et -180')
            }
          }))
        } catch (error) {
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          return null
        }

        let resPolygon

        try {
          resPolygon = polygon(coordinates, properties, { id })
        } catch (error) {
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          return null
        }

        for (const [, bbox] of Object.entries(RegionBounds)) {
          // @ts-ignore BBox and number[] error is confusing
          const regionGeometry = bboxPolygon(bbox)

          if (polygonInPolygon(resPolygon, regionGeometry)) {
            return resPolygon
          }
        }

        warnings.push({ numeroBio: String(record.numeroBio), message: `Parcelle ${id ?? ''} en dehors des régions autorisées` })
        return resPolygon
      }))

    // known error, we skip the record
    if (hasFeatureError) {
      yield { numeroBio: String(record.numeroBio), error: hasFeatureError }
      continue
    }
    if (!Date.parse(record.dateAudit)) {
      yield { numeroBio: String(record.numeroBio), error: new Error('champ dateAudit incorrect') }
      continue
    }
    yield {
      record: {
        numerobio: String(record.numeroBio),
        certification_state: CertificationState.CERTIFIED,
        oc_id: organismeCertificateur.id,
        oc_label: organismeCertificateur.nom,
        parcelles: featureCollection(features),
        audit_notes: record.commentaire,
        certification_date_debut: record.dateCertificationDebut,
        certification_date_fin: record.dateCertificationFin,
        audit_date: (new Date(record.dateAudit)).toISOString(),
        annee_reference_controle: record.anneeReferenceControle,
        metadata: {
          source: 'API Parcellaire',
          sourceLastUpdate: new Date().toISOString(),
          anneeAssolement: record.anneeAssolement
        }
      },
      warnings: warnings
    }
  }
}

/**
 * Analyse un flux JSON (stream) représentant des enregistrements de parcellaire,
 * et vérifie la cohérence de chaque enregistrement avant un traitement plus approfondi.
 *
 * @generator
 * @async
 * @param {NodeJS.ReadableStream} stream - Flux JSON contenant des enregistrements avec numeroBio et numeroClient.
 * @yields {{ numeroBio: string, error?: Error }} - Résultat de validation (numeroBio et éventuellement une erreur).
 */
async function * preparseAPIParcellaireStream (stream) {
  const streamRecords = stream.pipe(JSONStream.parse([true]))

  for await (const record of streamRecords) {
    const numeroBio = String(record.numeroBio)
    const operator = await fetchOperator(numeroBio)
    if (!operator) {
      yield { numeroBio, error: new Error('Numéro bio inconnu du portail de notification') }
      continue
    }
    if (operator.organismeCertificateur.numeroClient !== String(record.numeroClient)) {
      yield {
        numeroBio,
        error: new Error(`Numéro client différent -> numéro attendu : ${operator.organismeCertificateur.numeroClient}`)
      }
      continue
    }

    yield { numeroBio }
  }
}

/**
 * Consomme le générateur preparseAPIParcellaireStream et retourne tous les résultats.
 *
 * @async
 * @param {NodeJS.ReadableStream} stream - Flux JSON contenant des enregistrements parcellaire.
 * @returns {Promise<Array<{ numeroBio: string, error?: Error }>>} - Résultats de la pré-analyse.
 * @throws {InvalidRequestApiError} - Si le JSON est invalide.
 */
async function collectPreparseResults (stream) {
  const results = []

  try {
    for await (const record of preparseAPIParcellaireStream(stream)) {
      results.push(record)
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('Invalid JSON') || error.message.startsWith('Unexpected '))
    ) {
      throw new InvalidRequestApiError('Le fichier JSON est invalide.')
    }
    throw error
  }

  return results
}

/**
 * Valide et insère en base de données les enregistrements issus d’un flux JSON parcellaire.
 * Log les erreurs et avertissements, et retourne un résumé du traitement.
 *
 * @async
 * @param {NodeJS.ReadableStream} stream - Flux JSON contenant des objets parcellaire.
 * @param {OrganismeCertificateur} organismeCertificateur - Informations de l’organisme certificateur.
 * @returns {Promise<{
*   count: number,
*   errors: Array<[string, string]>,
*   warning: Array<[string, Array<{ numeroBio: string, message: string }>]>,
*   numeroBioValid: Array<{ numeroBio: string, nbParcelles: number }>,
*   numeroBioError: Array<string>
* }>}
*/
async function parcellaireStreamToDb (stream, organismeCertificateur) {
  const generator = parseAPIParcellaireStream(stream, { organismeCertificateur })
  let count = 0
  /** @type {Array<[String, String]>} */
  const errors = []
  /** @type {Array<[String,Array<{numeroBio: String, message: String}>]>} */
  const warning = []
  /** @type {Array<String>} */
  const numeroBioError = []
  /** @type {Array<{numeroBio:String, nbParcelles : number}>} */
  const numeroBioValid = []

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    for await (const { record, error, numeroBio, warnings } of generator) {
      count++
      if (error) {
        errors.push([numeroBio, error.message])
        numeroBioError.push(numeroBio)
        continue
      }
      if (warnings && warnings.length > 0) {
        warning.push([numeroBio, warnings])
      }

      try {
        await createOrUpdateOperatorRecord(record, null, client)
        numeroBioValid.push({ numeroBio: record.numerobio, nbParcelles: record.parcelles.features.length })
      } catch (e) {
        if (e.code === 'INVALID_API_REQUEST') {
          errors.push([record.numerobio, e.message])
          numeroBioError.push(record.numerobio)
          continue
        }
        // noinspection ExceptionCaughtLocallyJS
        throw e
      }
    }
  } catch (error) {
    await client.query('ROLLBACK;')
    client.release()

    if (error.message.startsWith('Invalid JSON') || error.message.startsWith('Unexpected ')) {
      throw new InvalidRequestApiError('Le fichier JSON est invalide.')
    }

    throw error
  }

  await client.query('COMMIT;')
  client.release()
  const importResult = await pool.query(
    `INSERT INTO parcellaire_imports
     (organisme_certificateur, objets_acceptes, objets_refuses)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['1', JSON.stringify(numeroBioValid), JSON.stringify(numeroBioError)]
  )
  const importId = importResult.rows[0].id

  for (const [numeroBio, message] of errors) {
    await pool.query(
      `INSERT INTO parcellaire_import_logs
       (import_id, numero_bio, type, message)
       VALUES ($1, $2, 'error', $3)`,
      [importId, numeroBio, message]
    )
  }

  for (const [numeroBio, ws] of warning) {
    for (const w of ws) {
      await pool.query(
        `INSERT INTO parcellaire_import_logs
         (import_id, numero_bio, type, message)
         VALUES ($1, $2, 'warning', $3)`,
        [importId, numeroBio, w.message]
      )
    }
  }

  return { count, errors, warning, numeroBioValid, numeroBioError }
}

/**
 * Crée un job d’import dans la table jobs_import pour tracer un import à exécuter.
 *
 * @async
 * @param {any} json - Payload brut à stocker.
 * @returns {Promise<number>} - ID du job créé.
 */
async function createImportJob (json) {
  const result = await pool.query(
    'INSERT INTO jobs_import (payload, status) VALUES ($1, $2) RETURNING id',
    [JSON.stringify(json), 'CREATE']
  )

  return result.rows[0].id
}

/**
 * Récupère l’état courant d’un job d’import.
 *
 * @async
 * @param {number} id - Identifiant du job.
 * @returns {Promise<{ status: string, result?: any, error?: string, ended?: Date, created?: Date }>} - Statut du job.
 */
async function getCurrentStatusJobs (id) {
  const result = await pool.query(
    'SELECT status, "result", ended, created from jobs_import where id = $1', [id]
  )

  if (result.rows.length === 0) {
    return { status: 'error', error: "Aucun job n'a cet id" }
  }

  const job = result.rows[0]

  if (job.status === 'PENDING' || job.status === 'CREATE') {
    return { status: job.status, created: job.created }
  }

  if (job.status === 'DONE') {
    return {
      status: job.status,
      result: job.result,
      ended: job.ended
    }
  }

  if (job.status === 'ERROR') {
    return {
      status: job.status,
      error: job.result,
      ended: job.ended
    }
  }
}

/**
 * Met à jour le statut et le résultat d’un job d’import.
 *
 * @async
 * @param {number} jobId - Identifiant du job.
 * @param {'CREATE' | 'PENDING' | 'DONE' | 'ERROR'} status - Nouveau statut du job.
 * @param {any} [result] - Résultat ou détails associés au job.
 * @returns {Promise<void>}
 */
async function updateImportJobStatus (jobId, status, result) {
  if (status === 'DONE' || status === 'ERROR') {
    await pool.query(
      'UPDATE jobs_import SET status=$1, result=$2, ended=NOW() WHERE id=$3',
      [status, result ?? '{}', jobId]
    )
  } else {
    await pool.query(
      'UPDATE jobs_import SET status=$1, result=$2 WHERE id=$3',
      [status, result ?? '{}', jobId]
    )
  }
}

/**
 * Exécute un job complet d’import parcellaire : lit le flux, insère en base et met à jour le statut du job.
 *
 * @async
 * @param {number} jobId - Identifiant du job.
 * @param {OrganismeCertificateur} organismeCertificateur - Informations de l’organisme certificateur.
 * @param {any} json - flux JSON à traiter.
 * @returns {Promise<void>}
 */
async function processFullJob (jobId, organismeCertificateur, json) {
  await updateImportJobStatus(jobId, 'PENDING')
  try {
    const result = await parcellaireStreamToDb(json, organismeCertificateur)
    await updateImportJobStatus(jobId, 'DONE', result)
  } catch (error) {
    console.error(error)
    updateImportJobStatus(jobId, 'ERROR', {
      name: error.name,
      message: error.message,
      stack: error.stack
    })
  }
}

/**
 * Return operator data from agencebio api
 *
 * @param {string} enter - The NumeroBio to be fetched.
 * @returns {Promise<AgenceBioNormalizedOperator>} - A promise that return operator data if it exists or null.
 */
async function fetchOperator (enter) {
  try {
    return await fetchOperatorByNumeroBio(enter)
  } catch (error) {
    return null
  }
}

module.exports = {
  parseAPIParcellaireStream,
  parcellaireStreamToDb,
  preparseAPIParcellaireStream,
  updateImportJobStatus,
  collectPreparseResults,
  createImportJob,
  processFullJob,
  getCurrentStatusJobs,
  fetchOperator
}
