'use strict'

const { feature, featureCollection, polygon } = require('@turf/helpers')
const JSONStream = require('jsonstream-next')
const pool = require('../db.js')
const {
  EtatProduction,
  CertificationState,
  RegionBounds
} = require('../enums')
const {
  parsePacDetailsFromComment,
  fetchOperatorByNumeroBio
} = require('./agence-bio.js')
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
 * Enumération des codes de log pour les imports parcellaires.
 * Permet de requêter et filtrer les logs par type d'erreur ou d'avertissement.
 *
 * @enum {string}
 */
const ImportLogType = {
  // Errors - validation basique
  MISSING_NUMERO_BIO: 'MISSING_NUMERO_BIO',
  MISSING_NUMERO_CLIENT: 'MISSING_NUMERO_CLIENT',
  // Errors - opérateur
  UNKNOWN_NUMERO_BIO: 'UNKNOWN_NUMERO_BIO',
  NOT_PRODUCTION: 'NOT_PRODUCTION',
  NO_OC: 'NO_OC',
  OC_MISMATCH: 'OC_MISMATCH',
  // Errors - dates du record
  INVALID_DATE_CERTIFICATION_DEBUT: 'INVALID_DATE_CERTIFICATION_DEBUT',
  INVALID_DATE_CERTIFICATION_FIN: 'INVALID_DATE_CERTIFICATION_FIN',
  MISSING_CERTIFICATION_DATES: 'MISSING_CERTIFICATION_DATES',
  INVALID_DATE_AUDIT: 'INVALID_DATE_AUDIT',
  // Errors - parcelle
  INVALID_ETAT_PRODUCTION: 'INVALID_ETAT_PRODUCTION',
  MISSING_DATE_ENGAGEMENT: 'MISSING_DATE_ENGAGEMENT',
  INVALID_DATE_ENGAGEMENT: 'INVALID_DATE_ENGAGEMENT',
  MISSING_CULTURES: 'MISSING_CULTURES',
  INVALID_CPF: 'INVALID_CPF',
  INVALID_GEOM: 'INVALID_GEOM',
  // Errors - BDD
  DB_ERROR: 'DB_ERROR',
  // Warnings
  MISSING_GEOM: 'MISSING_GEOM',
  GEOM_OUT_OF_BOUNDS: 'GEOM_OUT_OF_BOUNDS',
  GEOM_CORRECTED: 'GEOM_CORRECTED',
  GEOM_INVALID_NOT_CORRECTED: 'GEOM_INVALID_NOT_CORRECTED'
}

/**
 * @typedef {{ numeroBio: string, message: string, code: string }} ImportWarning
 * @typedef {{ record: Partial<NormalizedRecord>, numeroBio: string, warnings: ImportWarning[] }} ValidItem
/**
 * @typedef {{
*   numeroBio: string,
*   code: string,
*   message: string,
*   idParcelle?: string | null,
*   nomParcelle?: string | null
* }} ErrorItem
*  @typedef {{ message: string, code: string }} RecordError
*/

/**
 * Formate un préfixe d'identification de parcelle pour les messages d'erreur.
 *
 * @param {any} parcelle
* @returns {string}
 */
function formatParcelleName (parcelle) {
  const ilot = parcelle.numeroIlot != null ? String(parcelle.numeroIlot) : null
  const num = parcelle.numeroParcelle != null ? String(parcelle.numeroParcelle) : null
  if (parcelle.nom) return `Parcelle ${parcelle.nom}`
  if (ilot && num) return `Parcelle (îlot ${ilot}, n° ${num})`
  if (ilot) return `Parcelle (îlot ${ilot})`
  if (num) return `Parcelle (n° ${num})`
  return `Parcelle ${parcelle.id} `
}

/**
 * Créer une erreur pour une feature.
 *
 * @param {import('../outputs/types/api').InputApiParcelle} parcelle
 * @param {string} message
 * @param {string} code
 * @returns {any}
 */
function buildFeatureError (
  parcelle,
  message,
  code
) {
  return {
    code,
    message,
    idParcelle: parcelle.id,
    nomParcelle: formatParcelleName(parcelle)
  }
}

/**
 * @generator
 * @param {any} stream - a Json Stream
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @yields {{ record?: Partial<NormalizedRecord>, numeroBio?: string, error?: Error, errorType?: string, warnings?: ImportWarning[] }}
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  /**
   * @type {Promise<InputApiRecord>[]}
   */
  const streamRecords = stream

  for await (const record of streamRecords) {
    /** @type {ImportWarning[]} */
    const parcelleWarnings = []
    /** @type {RecordError[]} */
    const recordErrors = []

    const operator = await fetchOperator(String(record.numeroBio))

    if (operator == null) {
      recordErrors.push({
        message: 'Numéro bio inconnu du portail de notification',
        code: ImportLogType.UNKNOWN_NUMERO_BIO
      })
    } else {
      if (!operator.isProduction) {
        recordErrors.push({
          message: 'Numéro bio sans notification liée à une activité de production',
          code: ImportLogType.NOT_PRODUCTION
        })
      }
      if (!operator.organismeCertificateur) {
        recordErrors.push({
          message: 'Aucun organisme certificateur pour ce numéro bio.',
          code: ImportLogType.NO_OC
        })
      } else if (
        !('numeroClient' in operator.organismeCertificateur) ||
        operator.organismeCertificateur.numeroClient !== String(record.numeroClient)
      ) {
        recordErrors.push({
          message: 'Numéro client différent',
          code: ImportLogType.OC_MISMATCH
        })
      }
    }
    if (
      record.dateCertificationDebut &&
      isNaN(Date.parse(record.dateCertificationDebut))
    ) {
      recordErrors.push({
        message: 'champ dateCertificationDebut incorrect',
        code: ImportLogType.INVALID_DATE_CERTIFICATION_DEBUT
      })
    }

    if (
      record.dateCertificationFin &&
      isNaN(Date.parse(record.dateCertificationFin))
    ) {
      recordErrors.push({
        message: 'champ dateCertificationFin incorrect',
        code: ImportLogType.INVALID_DATE_CERTIFICATION_FIN
      })
    }

    if (!record.dateCertificationDebut || !record.dateCertificationFin) {
      recordErrors.push({
        message: 'Opérateur certifié sans dates de certification renseignées',
        code: ImportLogType.MISSING_CERTIFICATION_DATES
      })
    }

    if (isNaN(Date.parse(record.dateAudit))) {
      recordErrors.push({
        message: 'champ dateAudit incorrect',
        code: ImportLogType.INVALID_DATE_AUDIT
      })
    }

    const featureErrors = []

    const features = await Promise.all(
      record.parcelles.map(async (parcelle) => {
        const id = String(parcelle.id ?? getRandomFeatureId())
        const cultures = parcelle.culture ?? parcelle.cultures
        const pac = parsePacDetailsFromComment(parcelle.commentaire)
        const numeroIlot = parseInt(String(parcelle.numeroIlot), 10)
        const numeroParcelle = parseInt(String(parcelle.numeroParcelle), 10)
        let conversionNiveau
        try {
          conversionNiveau =
            parcelle.etatProduction &&
            normalizeEtatProduction(parcelle.etatProduction, { strict: true })
          if (
            conversionNiveau !== null &&
            [EtatProduction.C1, EtatProduction.C2, EtatProduction.C3].includes(
              conversionNiveau
            ) &&
            !Date.parse(parcelle.dateEngagement)
          ) {
            featureErrors.push(
              buildFeatureError(
                parcelle,
                "Champ date d'engagement obligatoire lorsque que la parcelle est en conversion",
                ImportLogType.MISSING_DATE_ENGAGEMENT
              ))
            return null
          }
        } catch (error) {
          featureErrors.push(
            buildFeatureError(
              parcelle,
              'champ etatProduction incorrect',
              ImportLogType.INVALID_ETAT_PRODUCTION
            ))

          return null
        }
        const properties = {
          id,
          cultures: cultures?.map(
            ({ codeCPF, quantite, variete = '', dateSemis = '', unite }) => ({
              id: randomUUID(),
              CPF: codeCPF,
              date_semis: dateSemis,
              surface: parseFloat(String(quantite)),
              unit: unite,
              variete
            })
          ),
          NUMERO_I: Number.isNaN(numeroIlot)
            ? pac
              ? pac.numeroIlot ?? null
              : null
            : String(numeroIlot),
          NUMERO_P: Number.isNaN(numeroParcelle)
            ? pac
              ? pac.numeroParcelle ?? null
              : null
            : String(numeroParcelle),
          PACAGE: record.numeroPacage ? String(record.numeroPacage) : null,
          conversion_niveau: conversionNiveau,
          engagement_date: parcelle.dateEngagement ?? null,
          auditeur_notes: parcelle.commentaire ?? null,
          TYPE: parcelle.codeCulture ?? null,
          CODE_VAR: parcelle.codePrecision ?? null,
          COMMUNE: parcelle.commune ?? null,
          NOM: parcelle.nom ?? null
        }

        if (parcelle.dateEngagement && !Date.parse(parcelle.dateEngagement)) {
          featureErrors.push(
            buildFeatureError(
              parcelle,
              'champ dateEngagement incorrect',
              ImportLogType.INVALID_DATE_ENGAGEMENT
            ))
        }
        if (!cultures?.length) {
          featureErrors.push(
            buildFeatureError(
              parcelle,
              'cultures absentes',
              ImportLogType.MISSING_CULTURES
            ))
        }

        const invalidCodes = cultures
          .filter((c) => !fromCodeCpf(c.codeCPF))
          .map((c) => c.codeCPF)

        if (invalidCodes.length > 0) {
          featureErrors.push(
            buildFeatureError(
              parcelle,
              `cultures inconnues: ${invalidCodes.join(', ')}`,
              ImportLogType.INVALID_CPF
            ))
        }

        let coordinates = []

        if (
          parcelle.geom === null ||
          parcelle.geom === undefined ||
          parcelle.geom === '' ||
          parcelle.geom === 'null'
        ) {
          parcelleWarnings.push({
            numeroBio: String(record.numeroBio),
            message: `Parcelle ${id ?? ''} n'a pas de géométrie`,
            code: ImportLogType.MISSING_GEOM
          })
          return feature(null, properties, { id })
        }

        try {
          coordinates = JSON.parse(parcelle.geom.replace(/}$/, ''))
          coordinates.forEach((ring) =>
            ring.forEach(([x, y]) => {
              if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error('les coordonnées doivent être des nombres finis')
              }
              if (y > 90 || y < -90) {
                throw new Error(
                  'la latitude doit être comprise entre 90 et -90'
                )
              }

              if (x > 180 || x < -180) {
                throw new Error(
                  'la longitude doit être comprise entre 180 et -180'
                )
              }
            })
          )
        } catch (error) {
          featureErrors.push(
            buildFeatureError(
              parcelle,
              'champ geom incorrect : ' + error.message,
              ImportLogType.INVALID_GEOM
            ))
          return null
        }

        let resPolygon

        try {
          resPolygon = polygon(coordinates, properties, { id })
        } catch (error) {
          featureErrors.push(
            buildFeatureError(
              parcelle,
              'champ geom incorrect : ' + error.message,
              ImportLogType.INVALID_GEOM
            ))
        }

        for (const [, bbox] of Object.entries(RegionBounds)) {
          // @ts-ignore BBox and number[] error is confusing
          const regionGeometry = bboxPolygon(bbox)

          if (polygonInPolygon(resPolygon, regionGeometry)) {
            return resPolygon
          }
        }

        parcelleWarnings.push({
          numeroBio: String(record.numeroBio),
          message: `Parcelle ${id ?? ''} en dehors des régions autorisées`,
          code: ImportLogType.GEOM_OUT_OF_BOUNDS
        })
        return resPolygon
      })
    )

    const allErrors = [...recordErrors, ...featureErrors]

    if (allErrors.length > 0) {
      yield {
        numeroBio: String(record.numeroBio),
        errors: allErrors,
        json: record
      }

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
        audit_date: new Date(record.dateAudit).toISOString(),
        annee_reference_controle: record.anneeReferenceControle,
        metadata: {
          source: 'API Parcellaire',
          sourceLastUpdate: new Date().toISOString(),
          anneeAssolement: record.anneeAssolement
        }
      },
      numeroBio: String(record.numeroBio),
      warnings: parcelleWarnings,
      json: record
    }
  }
}

/**
 * Consomme intégralement le générateur parseAPIParcellaireStream et sépare
 * les enregistrements valides des erreurs. C'est la seule passe de validation :
 * les validItems retournés contiennent les records déjà parsés et prêts pour l'insert.
 *
 * @async
 * @param {NodeJS.ReadableStream} stream - Flux JSON contenant des enregistrements parcellaire.
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @param {number} jobId - Id du job en cours
 * @returns {Promise<{ errors: ErrorItem[], validItems: ValidItem[] }>}
 * @throws {InvalidRequestApiError} - Si le JSON est invalide.
 */
async function collectFullValidationResults (stream, { organismeCertificateur }, jobId) {
  /** @type {ErrorItem[]} */
  const errors = []
  /** @type {ValidItem[]} */
  const validItems = []
  const items = []
  try {
    const jsonStream = stream.pipe(JSONStream.parse([true]))
    for await (const {
      record,
      numeroBio,
      errors: recordErrors,
      warnings,
      json
    } of parseAPIParcellaireStream(jsonStream, { organismeCertificateur })) {
      if (recordErrors?.length) {
        errors.push(
          ...recordErrors.map(err => ({
            numeroBio,
            ...err
          }))
        )
      } else {
        validItems.push({ record, numeroBio, warnings: warnings ?? [] })
      }
      items.push(json)
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('Invalid JSON') ||
        error.message.startsWith('Unexpected '))
    ) {
      throw new InvalidRequestApiError('Le fichier JSON est invalide.')
    }
    throw error
  }
  await addPayload(items, jobId)

  return { errors, validItems }
}

/**
 * Insère en base de données les enregistrements déjà validés.
 * Ne refait aucune validation métier : collecte uniquement les warnings post-insert
 * (corrections géométriques) et met à jour le job.
 *
 * @async
 * @param {ValidItem[]} validItems - Records déjà validés par collectFullValidationResults.
 * @param {ErrorItem[]} errors - Erreurs déjà collectées lors de la validation.
 * @param {number} jobId - Id du job en cours.
 * @returns {Promise<{
 *   count: number,
 *   errors: Array<{numeroBio:string, code: string, message: string}>,
 *   warning: Array<[string, ImportWarning[]]>,
 *   numeroBioValid: Array<{ numeroBio: string, nbParcelles: number }>,
 *   numeroBioError: Array<string>
 * }>}
 */
async function parcellaireValidItemsToDb (validItems, errors, jobId) {
  const count = validItems.length + errors.length
  /** @type {Array<{numeroBio:string, code: string, message: string}>} */
  const dbErrors = [...errors]
  /** @type {Array<[String, ImportWarning[]]>} */
  const warning = []
  /** @type {Array<String>} */
  const numeroBioError = errors.map(({ numeroBio }) => numeroBio)
  /** @type {Array<{numeroBio: String, nbParcelles: number}>} */
  const numeroBioValid = []

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    for (const { record, numeroBio, warnings } of validItems) {
      if (warnings?.length > 0) {
        warning.push([numeroBio, warnings])
      }

      try {
        const { parcelles } = await createOrUpdateOperatorRecord(record, null, client)
        const parcellesCorrigees = parcelles
          .filter(f => f.statut_import_geom === 'CORRIGE')
          .map(f => f.id)
          .filter(Boolean)

        const parcellesNonCorrigees = parcelles
          .filter(f => f.statut_import_geom === 'ACCEPTENONCORRIGE')
          .map(f => f.id)
          .filter(Boolean)

        const correctionWarnings = []
        if (parcellesCorrigees.length > 0) {
          correctionWarnings.push({
            numeroBio,
            message: `Ces parcelles ont été corrigées : ${parcellesCorrigees.join(', ')}`,
            code: ImportLogType.GEOM_CORRECTED
          })
        }

        if (parcellesNonCorrigees.length > 0) {
          correctionWarnings.push({
            numeroBio,
            message: `Ces parcelles n'ont pas été corrigées mais sont invalides : ${parcellesNonCorrigees.join(', ')}`,
            code: ImportLogType.GEOM_INVALID_NOT_CORRECTED
          })
        }

        if (correctionWarnings.length > 0) {
          warning.push([numeroBio, correctionWarnings])
        }

        numeroBioValid.push({
          numeroBio: record.numerobio,
          nbParcelles: record.parcelles.features.length
        })
      } catch (e) {
        if (e.code === 'INVALID_API_REQUEST') {
          dbErrors.push({ numeroBio: record.numerobio, message: e.message, code: ImportLogType.DB_ERROR })
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
    throw error
  }

  await client.query('COMMIT;')
  client.release()

  const importResult = await pool.query(
    `
    UPDATE parcellaire_import SET
    nb_objets_acceptes = $1,
    nb_objets_refuses = $2,
    nb_objets_recu = $3,
    result_job = $4,
    status = $5,
    ended_at = NOW()
    WHERE id = $6
    RETURNING id`,
    [
      numeroBioValid.length,
      numeroBioError.length,
      count,
      JSON.stringify({ count, errors: dbErrors, warning, numeroBioValid, numeroBioError }),
      'DONE',
      jobId
    ]
  )
  const importId = importResult.rows[0].id

  for (const { numeroBio, message, code } of dbErrors) {
    await pool.query(
      `INSERT INTO parcellaire_import_logs
       (import_id, numero_bio, type, code, message)
       VALUES ($1, $2, 'error', $3, $4)`,
      [importId, numeroBio, code, message]
    )
  }

  for (const [numeroBio, ws] of warning) {
    for (const w of ws) {
      await pool.query(
        `INSERT INTO parcellaire_import_logs
         (import_id, numero_bio, type, code, message)
         VALUES ($1, $2, 'warning', $3, $4)`,
        [importId, numeroBio, w.code, w.message]
      )
    }
  }

  return { count, errors: dbErrors, warning, numeroBioValid, numeroBioError }
}

/**
 * Crée un job d'import dans la table parcellaire_import pour tracer un import à exécuter.
 * Doit être appelé dès la réception du JSON, avant toute validation.
 *
 * @async
 * @param {number} organismeCertificateurId - Id de l'organisme certificateur.
 * @returns {Promise<number>} - ID du job créé.
 */
async function createImportJob (organismeCertificateurId) {
  const result = await pool.query(
    'INSERT INTO parcellaire_import (status, organisme_certificateur) VALUES ($1,$2) RETURNING id',
    ['CREATED', organismeCertificateurId]
  )

  return result.rows[0].id
}

/**
 * Stocke le payload d'un job
 *
 * @async
 * @param {any} json - Paylaod a stocker.
 * @param {number} jobId - Id de l'organisme certificateur.
 */
async function addPayload (json, jobId) {
  await pool.query(
    'INSERT INTO parcellaire_import_payload(import_id, payload) VALUES ($1 , $2)',
    [jobId, JSON.stringify(json)]
  )

  return json
}

/**
 * Crée un log pour une erreur de l'API
 *
 * @async
 * @param {number} jobId - Id du job en question.
 * @param {ErrorItem} error - erreur a sauvegarder.
 */
async function addErrorJob (jobId, error) {
  await pool.query(
    `INSERT INTO parcellaire_import_logs
     (
       import_id,
       numero_bio,
       parcelle_id,
       parcelle_name,
       type,
       code,
       message
     )
     VALUES ($1, $2, $3, $4, 'error', $5, $6)`,
    [
      jobId,
      error.numeroBio,
      error.idParcelle ?? null,
      error.nomParcelle ?? null,
      error.code,
      error.message
    ]
  )
}

/**
 * Met à jour le résultat d'un job d'import dans la table `parcellaire_import`.
 *
 * @async
 * @function updateJobError
 * @param {Array<string|number>} numeroBioValid - Liste des identifiants `numeroBio` valides.
 * @param {Array<Object>} numeroBioError - Liste des objets en erreur (doivent contenir au moins `numeroBio`).
 * @param {number} count - Nombre total d'objets traités.
 * @param {Array<Object>|null} warning - Liste des avertissements éventuels.
 * @param {string|number} jobId - Identifiant du job à mettre à jour.
 *
 * @returns {Promise<string|number>} Retourne l'identifiant du job mis à jour.
 *
 */
async function updateJobError (numeroBioValid, numeroBioError, count, warning, jobId) {
  const importResult = await pool.query(
    `
    UPDATE parcellaire_import SET
    nb_objets_acceptes = $1,
    nb_objets_refuses = $2,
    nb_objets_recu = $3,
    result_job = $4,
    status = $5,
    ended_at = NOW()
    WHERE id = $6
    RETURNING id`,
    [
      numeroBioValid.length,
      numeroBioError.length,
      count,
      JSON.stringify({ count, errors: numeroBioError, warning, numeroBioValid, numeroBioError: [...new Set(numeroBioError.map(e => e.numeroBio))] }),
      'DONE',
      jobId
    ]
  )

  return importResult.rows[0].id
}

/**
 * Récupère l'état courant d'un job d'import.
 *
 * @async
 * @param {number} id - Identifiant du job.
 * @returns {Promise<{ status: string,nbObjetsRecus? : number, nbObjetsAcceptes?:number,nbObjetsRefuses?:number, result?: any, error?: string, ended?: Date, created?: Date }>} - Statut du job.
 */
async function getCurrentStatusJobs (id) {
  const result = await pool.query(
    'SELECT status, nb_objets_recu,nb_objets_acceptes,nb_objets_refuses,result_job, ended_at, created_at from parcellaire_import where id = $1',
    [id]
  )

  if (result.rows.length === 0) {
    return { status: 'error', error: "Aucun job n'a cet id" }
  }

  const job = result.rows[0]

  if (job.status === 'PENDING' || job.status === 'CREATED') {
    return { status: job.status, created: job.created_at }
  }

  if (job.status === 'DONE') {
    return {
      status: job.status,
      nbObjetsRecus: job.nb_objets_recu,
      nbObjetsAcceptes: job.nb_objets_acceptes,
      nbObjetsRefuses: job.nb_objets_refuses,
      result: job.result_job,
      ended: job.ended_at
    }
  }

  if (job.status === 'ERROR') {
    return {
      status: job.status,
      error: job.result_job,
      ended: job.ended_at
    }
  }
  return { status: 'error', error: `Statut inconnu : ${job.status}` }
}

/**
 * Met à jour le statut et le résultat d'un job d'import.
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
      'UPDATE parcellaire_import SET status=$1, result_job=$2, ended_at=NOW() WHERE id=$3',
      [status, result ?? '{}', jobId]
    )
  } else {
    await pool.query(
      'UPDATE parcellaire_import SET status=$1, result_job=$2 WHERE id=$3',
      [status, result ?? '{}', jobId]
    )
  }
}

/**
 * Exécute la phase d'insert d'un job : reçoit les validItems déjà validés,
 * fait uniquement l'insert en base et collecte les warnings post-insert.
 * Appelé en fire-and-forget après la réponse au client.
 *
 * @async
 * @param {number} jobId - Identifiant du job.
 * @param {ValidItem[]} validItems - Records déjà validés par collectFullValidationResults.
 * @param {ErrorItem[]} errors - Erreurs déjà collectées lors de la validation.
 * @returns {Promise<void>}
 */
async function processFullJob (jobId, validItems, errors) {
  await updateImportJobStatus(jobId, 'PENDING')
  try {
    await parcellaireValidItemsToDb(validItems, errors, jobId)
  } catch (error) {
    console.error(error)
    await updateImportJobStatus(jobId, 'ERROR', {
      name: error.name,
      message: error.message
    })
  }
}

/**
 * Return operator data from agencebio api
 *
 * @param {string} numeroBio - The NumeroBio to be fetched.
 * @returns {Promise<AgenceBioNormalizedOperator>} - A promise that return operator data if it exists or null.
 */
async function fetchOperator (numeroBio) {
  try {
    return await fetchOperatorByNumeroBio(numeroBio)
  } catch (error) {
    return null
  }
}

/**
 * @param {{ status?: string, organismeCertificateur?: string, from?: string, to?: string, payload?: string, logs?: 'error' | 'warning' | 'all' | 'none' | null, page: string , limit: string }} params
 * @returns {Promise<{ data: object[], meta: { total: number, page: number, limit: number } }>}
 */
async function getImportList ({ status, from, to, payload, page, limit }) {
  const conditions = []
  const params = []
  let idx = 1

  if (status) {
    const statusList = status.split(',').map(s => s.trim().toUpperCase())
    conditions.push(`pi.status = ANY($${idx}::text[])`)
    params.push(statusList)
    idx++
  }

  if (from) {
    conditions.push(`pi.created_at >= $${idx}`)
    params.push(new Date(from))
    idx++
  }

  if (to) {
    conditions.push(`pi.created_at <= $${idx}`)
    params.push(new Date(to))
    idx++
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const payloadSelect = payload === 'true'
    ? ', json_build_object(\'id\', pip.id, \'payload\', pip.payload) AS payload'
    : ', NULL AS payload'
  const payloadJoin = payload === 'true'
    ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id'
    : ''
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [rows, countResult] = await Promise.all([
    pool.query(`
      SELECT
        pi.id as jobId,
        pi.status,
        pi.created_at,
        pi.ended_at,
        pi.nb_objets_recu,
        pi.nb_objets_acceptes,
        pi.nb_objets_refuses,
        pi.result_job
        ${payloadSelect}
      FROM parcellaire_import pi
      ${payloadJoin}
      ${whereClause}
      ORDER BY pi.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, [...params, parseInt(limit), offset]),
    pool.query(`
      SELECT COUNT(*) AS total
      FROM parcellaire_import pi
      ${whereClause}
    `, params)
  ])

  return {
    data: rows.rows.map(normalizeJobReturn),
    meta: {
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    }
  }
}

/**
 * @param {{ id: string | number, payload?: string, logs?: 'error' | 'warning' | 'all' | 'none' | null }} params
 * @returns {Promise<object | null>}
 */
async function getImportById ({ id, payload }) {
  const payloadSelect = payload === 'true'
    ? ', json_build_object(\'id\', pip.id, \'payload\', pip.payload) AS payload'
    : ', NULL AS payload'
  const payloadJoin = payload === 'true'
    ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id'
    : ''

  const { rows } = await pool.query(`
    SELECT
      pi.id,
      pi.status,
      pi.created_at,
      pi.started_at,
      pi.ended_at,
      pi.nb_objets_recu,
      pi.nb_objets_acceptes,
      pi.nb_objets_refuses,
      pi.result_job
      ${payloadSelect}
    FROM parcellaire_import pi
    ${payloadJoin}
    WHERE pi.id = $1
  `, [id])

  return normalizeJobReturn(rows[0]) ?? null
}

// Décommenter si les utilisateurs en font la demande
// /**
//  * @param {{ id: string | number, type: string }} params
//  * @returns {Promise<object[]>}
//  */
// async function getImportLogs ({ id, type }) {
//   const conditions = ['import_id = $1']
//   const params = [id]
//   let idx = 2

//   if (type !== 'all') {
//     conditions.push(`type = $${idx}`)
//     params.push(type)
//     idx++
//   }

//   const { rows } = await pool.query(`
//     SELECT id, type, code, message, numero_bio
//     FROM parcellaire_import_logs
//     WHERE ${conditions.join(' AND ')}
//     ORDER BY id ASC
//   `, params)

//   return rows
// }

function normalizeJobReturn (row) {
  return {
    jobId: row.jobid,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    nbObjetsRecus: row.nb_objets_recu,
    nbObjetsAcceptes: row.nb_objets_acceptes,
    nbObjetsRefuses: row.nb_objets_refuses,
    result: row.result_job,
    payload: row.payload
  }
}

module.exports = {
  ImportLogType,
  parseAPIParcellaireStream,
  collectFullValidationResults,
  parcellaireValidItemsToDb,
  updateImportJobStatus,
  createImportJob,
  processFullJob,
  getCurrentStatusJobs,
  fetchOperator,
  getImportList,
  getImportById,
  addErrorJob,
  updateJobError
  // getImportLogs
}
