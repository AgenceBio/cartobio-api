import { randomUUID } from 'node:crypto'
import JSONStream from 'jsonstream-next'
import { polygon } from '@turf/helpers'
import bboxPolygon from '@turf/bbox-polygon'
import polygonInPolygon from '@turf/boolean-intersects'
import { fromCodeCpf } from '@agencebio/rosetta-cultures'
import { CertificationState, EtatProduction, RegionBounds } from '@agencebio/cartobio-types'
import type { AgenceBioNormalizedOperator, ImportJobStatusResponse, ImportSummary, CartoBioFeatureCollectionInput, CartoBioFeatureInput, CartoBioFeatureProperties, InputApiParcelle, InputApiRecord, NormalizedRecord, OrganismeCertificateur } from '@agencebio/cartobio-types'
import type { Position } from 'geojson'
import { InvalidRequestApiError } from '../../../shared/errors.js'
import { getRandomFeatureId } from '../../../shared/outputs/features.js'
import { normalizeEtatProduction } from '../../../shared/outputs/record.js'
import { createOrUpdateOperatorRecord } from '../../../shared/parcellaires/parcellaires.service.js'
import { parsePacDetailsFromComment, fetchOperatorByNumeroBio } from '../../../clients/agence-bio.client.js'
import * as repository from '../imports.repository.js'
import { withTransaction } from '../../../database/transaction.js'
import { logger } from '../../../config/logger.js'

/**
 * Enumération des codes de log pour les imports parcellaires.
 * Permet de requêter et filtrer les logs par type d'erreur ou d'avertissement.
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
  GEOM_INVALID_NOT_CORRECTED: 'GEOM_INVALID_NOT_CORRECTED',
  PAC_PENDING_WITH_ILOT: 'PAC_PENDING_WITH_ILOT'
}

type ImportWarning = { numeroBio: string, message: string, code: string }
interface ImportJobListRow {
  jobid?: number
  id?: number
  status: ImportSummary['status']
  created_at: Date
  started_at?: Date | null
  ended_at: Date | null
  numerobio: string | null
  numeroclient: string | null
  audit_date: string | null
  result_job: Record<string, unknown> | null
  payload: { id: number; payload: unknown } | null
}
type ImportJobStatusResult = ImportJobStatusResponse | { status: 'error'; error: string }
type ValidItem = { record: Omit<Partial<NormalizedRecord>, 'parcelles'> & Pick<NormalizedRecord, 'numerobio'> & { parcelles: CartoBioFeatureCollectionInput }, numeroBio: string, warnings: ImportWarning[] }
type RecordError = { message: string, code: string }
type FeatureError = RecordError & { idParcelle?: string | number | null, nomParcelle?: string | null }
type ErrorItem = FeatureError & { numeroBio?: string }

/**
 * Formate un préfixe d'identification de parcelle pour les messages d'erreur.
 */
function formatParcelleName (parcelle: InputApiParcelle): string {
  const ilot = parcelle.numeroIlot != null ? String(parcelle.numeroIlot) : null
  const num = parcelle.numeroParcelle != null ? String(parcelle.numeroParcelle) : null
  if (parcelle.nom) return `${parcelle.nom}`
  if (ilot && num) return `Îlot ${ilot} parcelle ${num}`
  if (ilot) return `Îlot ${ilot}`
  if (num) return `Parcelle ${num}`
  return '-'
}

/**
 * Créer une erreur pour une feature.
 */
function buildFeatureError (parcelle: InputApiParcelle, message: string, code: string): FeatureError {
  return {
    code,
    message,
    idParcelle: parcelle.id,
    nomParcelle: formatParcelleName(parcelle)
  }
}

async function * parseAPIParcellaireStream (stream: AsyncIterable<unknown> | Iterable<unknown> | object, { organismeCertificateur }: { organismeCertificateur: OrganismeCertificateur }) {
  const payloads = Symbol.asyncIterator in stream || Symbol.iterator in stream ? stream : [stream]
  const streamRecords = (async function * (): AsyncGenerator<InputApiRecord> {
    for await (const payload of payloads) {
      if (Array.isArray(payload)) yield * payload
      else yield payload as InputApiRecord
    }
  })()

  for await (const record of streamRecords) {
    const parcelleWarnings: ImportWarning[] = []
    const recordErrors: RecordError[] = []

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

    const featureErrors: FeatureError[] = []

    const features = await Promise.all(
      record.parcelles.map(async (parcelle) => {
        const id = String(parcelle.id ?? getRandomFeatureId())
        const cultures = parcelle.culture ?? parcelle.cultures
        const pac = parsePacDetailsFromComment(parcelle.commentaire)
        const numeroIlot = parseInt(String(parcelle.numeroIlot), 10)
        const numeroParcelle = parseInt(String(parcelle.numeroParcelle), 10)

        if (!Number.isNaN(numeroIlot) && numeroIlot !== 0 && (parcelle.enAttentePac === true || parcelle.enAttentePac === 1)) {
          parcelle.enAttentePac = false
          parcelleWarnings.push({
            numeroBio: String(record.numeroBio),
            message: `Parcelle ${id ?? ''} acceptée mais ne peut être en attente PAC car un ilôt PAC est renseigné`,
            code: ImportLogType.PAC_PENDING_WITH_ILOT
          })
        }

        let conversionNiveau: string | undefined
        try {
          conversionNiveau =
            parcelle.etatProduction &&
            normalizeEtatProduction(parcelle.etatProduction, { strict: true })
          if (
            conversionNiveau !== null &&
            [EtatProduction.C1, EtatProduction.C2, EtatProduction.C3].some((etat) => etat === conversionNiveau) &&
            !Date.parse(parcelle.dateEngagement)
          ) {
            featureErrors.push(buildFeatureError(
              parcelle,
              "Champ date d'engagement obligatoire lorsque que la parcelle est en conversion",
              ImportLogType.MISSING_DATE_ENGAGEMENT
            ))
          }
        } catch (error) {
          logger.warn({ err: error }, 'champ etatProduction incorrect')
          featureErrors.push(buildFeatureError(parcelle, 'champ etatProduction incorrect', ImportLogType.INVALID_ETAT_PRODUCTION))
        }
        const properties: CartoBioFeatureProperties = {
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
          conversion_niveau: conversionNiveau ?? '',
          engagement_date: parcelle.dateEngagement ?? null,
          auditeur_notes: parcelle.commentaire ?? null,
          TYPE: parcelle.codeCulture ?? null,
          CODE_VAR: parcelle.codePrecision ?? null,
          COMMUNE: parcelle.commune ?? null,
          NOM: parcelle.nom ?? null,
          attente_pac: parcelle.enAttentePac === true || parcelle.enAttentePac === 1
        }

        if (parcelle.dateEngagement && !Date.parse(parcelle.dateEngagement)) {
          featureErrors.push(buildFeatureError(parcelle, 'champ dateEngagement incorrect', ImportLogType.INVALID_DATE_ENGAGEMENT))
        }
        if (!cultures?.length) {
          featureErrors.push(buildFeatureError(parcelle, 'cultures absentes', ImportLogType.MISSING_CULTURES))
        }

        const invalidCodes = (cultures ?? [])
          .filter((c) => !fromCodeCpf(c.codeCPF))
          .map((c) => c.codeCPF)

        if (invalidCodes.length > 0) {
          featureErrors.push(buildFeatureError(parcelle, `cultures inconnues: ${invalidCodes.join(', ')}`, ImportLogType.INVALID_CPF))
        }

        let coordinates: Position[][] = []

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
          const featureSansGeometrie: CartoBioFeatureInput = { type: 'Feature', id, geometry: null, properties }
          return featureSansGeometrie
        }

        try {
          coordinates = JSON.parse(parcelle.geom.replace(/}$/, ''))
          coordinates.forEach((ring): void =>
            ring.forEach(([x, y]): void => {
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
          const message = error instanceof Error ? error.message : String(error)
          featureErrors.push(buildFeatureError(parcelle, 'champ geom incorrect : ' + message, ImportLogType.INVALID_GEOM))
          return null
        }

        let resPolygon

        try {
          resPolygon = polygon(coordinates, properties, { id })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          featureErrors.push(buildFeatureError(parcelle, 'champ geom incorrect : ' + message, ImportLogType.INVALID_GEOM))
        }

        if (!resPolygon) {
          return null
        }

        for (const [, bbox] of Object.entries(RegionBounds)) {
          const regionGeometry = bboxPolygon([bbox[0], bbox[1], bbox[2], bbox[3]])

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
        parcelles: { type: 'FeatureCollection' as const, features: features.filter((f) => f !== null) },
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
 * @param stream Flux JSON contenant des enregistrements parcellaire.
 * @throws {@link InvalidRequestApiError} Si le JSON est invalide.
 */
async function collectFullValidationResults (stream: NodeJS.ReadableStream, { organismeCertificateur }: { organismeCertificateur: OrganismeCertificateur }, jobId: number): Promise<{ errors: ErrorItem[]; validItems: ValidItem[] }> {
  const errors: ErrorItem[] = []
  const validItems: ValidItem[] = []
  const items: InputApiRecord[] = []
  let statusUpdated = false

  try {
    const jsonStream = stream.pipe(JSONStream.parse([]))
    for await (const { record, numeroBio, errors: recordErrors, warnings, json } of parseAPIParcellaireStream(jsonStream, { organismeCertificateur })) {
      if (!statusUpdated && json) {
        await updateStatus(jobId, json)
        statusUpdated = true
      }
      if (recordErrors?.length) {
        errors.push(...recordErrors.map(err => ({ numeroBio, ...err })))
      } else if (record) {
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
 * @param validItems Records déjà validés par collectFullValidationResults.
 * @param errors Erreurs déjà collectées lors de la validation.
 */
async function parcellaireValidItemsToDb (validItems: ValidItem[], errors: ErrorItem[], jobId: number): Promise<{
    count: number
    errors: Array<{ numeroBio?: string; code: string; message: string }>
    warning: Array<[string, ImportWarning[]]>
    numeroBioValid: Array<{ numeroBio: string; nbParcelles: number }>
    numeroBioError: Array<string | undefined>
}> {
  const count = validItems.length + errors.length
  const dbErrors: Array<{ numeroBio?: string; code: string; message: string }> = [...errors]
  const warning: Array<[string, ImportWarning[]]> = []
  const numeroBioError: Array<string | undefined> = errors.map(({ numeroBio }) => numeroBio)
  const numeroBioValid: Array<{ numeroBio: string; nbParcelles: number }> = []

  await withTransaction(async (client): Promise<void> => {
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

        const correctionWarnings: ImportWarning[] = []
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
        const apiError = e as { code?: string; message?: string }
        if (apiError.code === 'INVALID_API_REQUEST' || apiError.code === 'MISSING_GEOMETRY') {
          dbErrors.push({
            numeroBio: record.numerobio,
            message: apiError.message || 'Erreur de validation lors de l’import.',
            code: apiError.code === 'MISSING_GEOMETRY' ? ImportLogType.MISSING_GEOM : ImportLogType.DB_ERROR
          })
          numeroBioError.push(record.numerobio)
          continue
        }
        // noinspection ExceptionCaughtLocallyJS
        throw e
      }
    }
  })

  const importId = await repository.completeImportJob({
    result: { count, errors: dbErrors, warning, numeroBioValid, numeroBioError },
    jobId
  })

  for (const { numeroBio, message, code } of dbErrors) {
    await repository.insertImportLog(importId, { numeroBio, type: 'error', code, message })
  }

  for (const [numeroBio, ws] of warning) {
    for (const w of ws) {
      await repository.insertImportLog(importId, { numeroBio, type: 'warning', code: w.code, message: w.message })
    }
  }

  return { count, errors: dbErrors, warning, numeroBioValid, numeroBioError }
}

/**
 * Crée un job d'import dans la table parcellaire_import pour tracer un import à exécuter.
 * Doit être appelé dès la réception du JSON, avant toute validation.
 *
 * @returns ID du job créé.
 */
async function createImportJob (organismeCertificateurId: number): Promise<number> {
  return repository.createImportJob(organismeCertificateurId)
}

/**
 * Stocke le payload d'un job
 */
async function addPayload (json: InputApiRecord[], jobId: number) {
  await repository.insertPayload(jobId, json)

  const [firstRecord] = json

  await repository.updateImportJobRecordInfos(jobId, {
    numeroBio: firstRecord?.numeroBio ? String(firstRecord.numeroBio) : null,
    numeroClient: firstRecord?.numeroClient ? String(firstRecord.numeroClient) : null,
    auditDate: firstRecord?.dateAudit && !isNaN(Date.parse(firstRecord.dateAudit)) ? new Date(firstRecord.dateAudit).toISOString() : null
  })

  return json
}

/**
 * Crée un log pour une erreur de l'API
 */
async function addErrorJob (jobId: number, error: ErrorItem): Promise<void> {
  await repository.insertImportLog(jobId, {
    numeroBio: error.numeroBio,
    idParcelle: error.idParcelle ?? null,
    nomParcelle: error.nomParcelle ?? null,
    type: 'error',
    code: error.code,
    message: error.message
  })
}

/**
 * Met à jour le résultat d’un job d’import dans la table `parcellaire_import`.
 *
 * @param numeroBioValid Liste des identifiants `numeroBio` valides.
 * @param numeroBioError Liste des objets en erreur (doivent contenir au moins `numeroBio`).
 * @param count Nombre total d’objets traités.
 * @param warning Liste des avertissements éventuels.
 */
async function updateJobError (numeroBioValid: Array<string | number>, numeroBioError: Array<{ numeroBio?: string | number }>, count: number, warning: Array<object> | null, jobId: string | number): Promise<string | number> {
  return repository.completeImportJob({
    result: { count, errors: numeroBioError, warning, numeroBioValid, numeroBioError: [...new Set(numeroBioError.map(e => e.numeroBio))] },
    jobId,
    statutJob: 'REJECTED'
  })
}

/**
 * Récupère l'état courant d'un job d'import.
 */
async function getCurrentStatusJobs (id: number | string, organismeCertificateur: number): Promise<ImportJobStatusResult> {
  const job = await repository.findImportJob(id, organismeCertificateur)

  if (!job) {
    return { status: 'error', error: "Aucun job n'a cet id" }
  }

  if (job.status === 'PENDING' || job.status === 'CREATED') {
    return { status: job.status, created: job.created_at }
  }

  if (job.status === 'DONE') {
    return {
      status: job.status,
      numeroBio: job.numerobio,
      numeroClient: job.numeroclient,
      auditDate: job.audit_date,
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
 * @param result Résultat ou détails associés au job.
 */
async function updateImportJobStatus (jobId: number, status: 'CREATE' | 'PENDING' | 'DONE' | 'ERROR', result?: Record<string, unknown>): Promise<void> {
  await repository.updateImportJobStatus(jobId, status, result)
}

/**
 * Exécute la phase d'insert d'un job : reçoit les validItems déjà validés,
 * fait uniquement l'insert en base et collecte les warnings post-insert.
 * Appelé en fire-and-forget après la réponse au client.
 *
 * @param validItems Records déjà validés par collectFullValidationResults.
 * @param errors Erreurs déjà collectées lors de la validation.
 */
async function processFullJob (jobId: number, validItems: ValidItem[], errors: ErrorItem[]): Promise<void> {
  await updateImportJobStatus(jobId, 'PENDING')
  try {
    const result = await parcellaireValidItemsToDb(validItems, errors, jobId)
    await repository.updateImportJobResult(jobId, result.errors.length > 0 ? 'REJECTED' : 'VALID')
  } catch (error) {
    logger.error({ err: error }, `Traitement du job d'import ${jobId} en échec`)
    const message = error instanceof Error ? error.message : String(error)
    const name = error instanceof Error ? error.name : String(error)

    await repository.failImportJob(jobId, { name, message })
  }
}

/**
 * Return operator data from agencebio api
 */
async function fetchOperator (numeroBio: string): Promise<AgenceBioNormalizedOperator | null> {
  try {
    return await fetchOperatorByNumeroBio(numeroBio)
  } catch (error) {
    logger.error({ err: error }, `Opérateur ${numeroBio} introuvable`)
    return null
  }
}

async function getImportList ({ status, organismeCertificateur, from, to, payload, withRejected, page, limit }: { status?: string; organismeCertificateur?: number; from?: string; to?: string; payload?: string; withRejected?: string; page: number; limit: number }): Promise<{ data: ImportSummary[]; meta: { total: number; page: number; limit: number } }> {
  const { rows, total } = await repository.findImportList({ status, organismeCertificateur, from, to, payload, withRejected, page, limit })

  return {
    data: rows.map(normalizeJobReturn),
    meta: {
      total,
      page,
      limit
    }
  }
}

async function getImportById ({ id, payload, organismeCertificateur }: { id: string | number; payload?: string; organismeCertificateur: number }): Promise<ImportSummary | null> {
  const row = await repository.findImportById(id, organismeCertificateur, payload)
  return row ? normalizeJobReturn(row) : null
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

/**
 * Renseigne les métadonnées du job depuis le premier record reçu et détermine
 * s'il s'agit d'une création ou de la mise à jour d'un import existant.
 *
 * @param record Premier record du flux.
 */
async function updateStatus (jobId: number, record: Pick<InputApiRecord, 'numeroBio' | 'numeroClient' | 'dateAudit'>): Promise<void> {
  const numeroBio = record?.numeroBio != null ? String(record.numeroBio) : null
  const numeroClient = record?.numeroClient != null ? String(record.numeroClient) : null
  const auditDate = record?.dateAudit && !Number.isNaN(Date.parse(record.dateAudit))
    ? new Date(record.dateAudit).toISOString().slice(0, 10)
    : null

  await repository.updateImportJobEtat(jobId, { numeroBio, numeroClient, auditDate })
}

function normalizeJobReturn (row: ImportJobListRow): ImportSummary {
  return {
    jobId: row.jobid,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    numeroBio: row.numerobio,
    numeroClient: row.numeroclient,
    auditDate: row.audit_date,
    result: row.result_job,
    payload: row.payload
  }
}

export {
  ImportLogType,
  parseAPIParcellaireStream,
  collectFullValidationResults,
  parcellaireValidItemsToDb,
  updateImportJobStatus,
  createImportJob,
  processFullJob,
  updateStatus,
  getCurrentStatusJobs,
  fetchOperator,
  getImportList,
  getImportById,
  addErrorJob,
  updateJobError
}
