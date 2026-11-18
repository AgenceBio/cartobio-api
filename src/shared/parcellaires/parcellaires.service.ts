import { polygon } from '@turf/helpers'
import type { Polygon } from 'geojson'
import { db } from '../../database/database.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { CertificationState, EventType } from '@agencebio/cartobio-types'
import type { CartoBioUser, DBOperatorRecord, DBOperatorRecordWithParcelles, DBParcelle, NormalizedRecord, HistoryEntry, CartoBioCulture, CartoBioFeatureInput, CartoBioFeatureCollectionInput, CultureInput } from '@agencebio/cartobio-types'
import { fetchEmailForNumeroBio } from '../../clients/agence-bio.client.js'
import { sendCertificationComplete } from '../../services/mailer/utils.js'
import { logger } from '../../config/logger.js'
import * as repository from './parcellaires.repository.js'
import { createNewEvent } from '../outputs/history.js'
import { InvalidRequestApiError, getErrorCode } from '../errors.js'
import { getRandomFeatureId, populateWithMultipleCultures } from '../outputs/features.js'
import { normalizeRecord, normalizeRecordSummary } from '../outputs/record.js'
import { getHistoryUser } from '../../modules/auth/auth.service.js'
import { setHistoryUsers } from './parcellaires.utils.js'

/**
 * Create a new record unless we find a dangling one with the same numeroBio and audit date, in which case we update it
 * with the merge algorithm described in ../../docs/rfc/[001-api-parcellaire.md](http://001-api-parcellaire.md)
 */
async function createOrUpdateOperatorRecord (record: Omit<Partial<NormalizedRecord>, 'parcelles'> & { parcelles: CartoBioFeatureCollectionInput }, context: { user?: CartoBioUser | null; copyParcellesData?: boolean; previousRecordId?: string; fromAPI?: boolean } | null = {}, parentTx: NodePgDatabase = db): Promise<DBOperatorRecordWithParcelles> {
  const certificationState =
    record.certification_state || CertificationState.OPERATOR_DRAFT

  try {
    const { operator, parcelles, shouldNotifyCertification } = await parentTx.transaction(async (tx) => {
      let preparedFeatures = await prepareFeatures(record.parcelles.features)

      const previousMap = await loadPreviousFullData(
        tx,
        context,
        record.numerobio ? record.numerobio : '',
        preparedFeatures
      )

      preparedFeatures = applyPreviousData(
        preparedFeatures,
        previousMap,
        context
      )

      const historyEntry: HistoryEntry = createNewEvent(
        EventType.FEATURE_COLLECTION_CREATE,
        {
          features: preparedFeatures,
          state: certificationState,
          metadata: record.metadata,
          date: new Date()
        },
        { user: context?.user, record: null }
      )

      const previousCertificationState = await repository.findCertificationStateAtAuditDate(tx, record.numerobio, record.audit_date)

      const operator = await repository.upsertOperator(
        tx,
        record,
        certificationState,
        historyEntry
      )

      const recordId = operator.record_id

      if (operator.certification_state === CertificationState.CERTIFIED) {
        if (!operator.certification_date_debut || !operator.certification_date_fin) {
          throw new InvalidRequestApiError('Les dates de certification sont manquantes.')
        }
      }

      const parcelles = await repository.upsertParcelles(tx, recordId, preparedFeatures)

      await repository.deleteMissingParcelles(tx, recordId, parcelles)

      if (context?.copyParcellesData && context?.previousRecordId) {
        const addedParcelles = await repository.copyParcellesFromPreviousRecord(tx, recordId, operator.numerobio, context.previousRecordId)
        parcelles.push(...addedParcelles)
      }

      if (record.certification_state === 'CERTIFIED') {
        await repository.updateMixite(tx, recordId)
      }

      const shouldNotifyCertification = previousCertificationState !== CertificationState.CERTIFIED && record.certification_state === CertificationState.CERTIFIED

      return { operator, parcelles, shouldNotifyCertification }
    })

    if (shouldNotifyCertification) {
      await notifyCertificationComplete(operator, parentTx)
    }

    return withHistoryUsers({ ...operator, parcelles })
  } catch (e) {
    if (getErrorCode(e) === '23502') {
      throw new InvalidRequestApiError('La donnée géographique est manquante ou invalide.')
    }

    throw e
  }
}

async function notifyCertificationComplete (record: Parameters<typeof sendCertificationComplete>[0], tx: NodePgDatabase = db): Promise<void> {
  try {
    const emails = await fetchEmailForNumeroBio(record.numerobio)
    for (const utilisateur of emails.utilisateurs) {
      const info = await sendCertificationComplete(record, utilisateur.email)
      logger.info({ info }, `Mail de certification envoyé à ${utilisateur.email}`)
    }
    await repository.markCertificationNotified(tx, String(record.record_id))
  } catch (error) {
    logger.error({ err: error }, `Erreur lors de l'envoi de la notification de certification pour le record ${record.record_id}`)
  }
}

/**
 * Load the parcelles of a previous record to allow data copy across records
 */
async function loadPreviousFullData (tx: NodePgDatabase, context: { copyParcellesData?: boolean; previousRecordId?: string } | null, numerobio: string, features: Array<CartoBioFeatureInput>): Promise<Map<string | number, DBParcelle>> {
  if (!context?.copyParcellesData || !context?.previousRecordId) {
    return new Map()
  }

  const previousMap = new Map<string | number, DBParcelle>()

  for (const feature of features) {
    if (!feature.id || !feature.geometry) continue

    const previous = await repository.findMatchingPreviousParcelle(tx, numerobio, context.previousRecordId, feature.geometry)

    if (previous) {
      previousMap.set(feature.id, previous)
    }
  }

  return previousMap
}

/**
 * Normalize, validate and enrich a list of GeoJSON features before database insertion:
 * - populates multiple cultures
 * - fixes invalid geometries
 * - resolves commune code
 * - flags features as foreign (hors France)
 */
async function prepareFeatures (features: Array<CartoBioFeatureInput>): Promise<Array<CartoBioFeatureInput>> {
  const sorted = [...features]

  return await Promise.all(sorted.map(async (feature) => {
    if (!feature.id) {
      feature = { ...feature, id: getRandomFeatureId() }
    }
    feature = populateWithMultipleCultures(feature)
    if (feature.geometry) {
      let geometry = feature.geometry
      const fixResult = await fixGeometry(geometry)
      const id = feature.id
      const featureLabel = feature.properties.NUMERO_I && feature.properties.NUMERO_P
        ? `îlot ${feature.properties.NUMERO_I} parcelle ${feature.properties.NUMERO_P}`
        : feature.properties.NOM || feature.id

      if (fixResult.statut === 'UNCORRECTABLE') {
        throw new InvalidRequestApiError(`Une géométrie n'est pas corrigeable (${featureLabel})`)
      }

      if (fixResult.statut === 'CORRIGE') {
        feature = polygon(
          fixResult.geometry.coordinates,
          feature.properties,
          { id }
        )
        geometry = fixResult.geometry
      }

      feature.properties.statut_import_geom =
      fixResult.statut === 'CORRIGE'
        ? 'CORRIGE'
        : fixResult.statut === 'ACCEPTENONCORRIGE'
          ? 'ACCEPTENONCORRIGE'
          : 'ACCEPTE'

      const etranger = await repository.isEtranger(geometry)
      feature.properties.etranger = etranger

      if (etranger) {
        feature.properties.COMMUNE = null
      } else {
        const valid =
        feature.properties.COMMUNE &&
        await repository.communeExists(geometry, feature.properties.COMMUNE)
        feature.properties.COMMUNE = valid
          ? feature.properties.COMMUNE
          : await repository.findCommune(geometry, feature.properties.COMMUNE)
      }
    }
    return feature
  }))
}

/**
 * Merge data from a previous record into the prepared features (conversion_niveau, engagement_date, NOM, cultures)
 * No-op if context.copyParcellesData is falsy
 */
function applyPreviousData (features: Array<CartoBioFeatureInput>, previousMap: Map<string | number, DBParcelle>, context: { copyParcellesData?: boolean } | null): Array<CartoBioFeatureInput> {
  if (!context?.copyParcellesData) return features

  return features.map(f => {
    const prev = f.id ? previousMap.get(f.id) : undefined
    if (!prev) return f

    const newCultures = f.properties.cultures || []
    const oldCultures = prev.cultures || []

    return {
      ...f,
      properties: {
        ...f.properties,

        cultures: mergeCulturesExact(newCultures, oldCultures),

        conversion_niveau:
          f.properties.conversion_niveau === 'AB?'
            ? prev.conversion_niveau
            : f.properties.conversion_niveau || prev.conversion_niveau,

        engagement_date:
          f.properties.engagement_date || prev.engagement_date,

        NOM:
          f.properties.NOM || prev.name
      }
    }
  })
}

/**
 * Merge cultures from a previous record into new cultures, preserving varietes by CPF match
 */
function mergeCulturesExact (newCultures: Array<CultureInput> = [], oldCultures: Array<CartoBioCulture> = []): Array<CultureInput> {
  const map = new Map()

  for (const newC of newCultures) {
    const cpf = newC.CPF

    const varietes = oldCultures
      .filter(o => o.CPF === cpf && o.variete)
      .map(o => o.variete)

    if (varietes.length) {
      map.set(cpf, Array.from(new Set(varietes)).join('; '))
    }
  }

  return newCultures.map(c => ({
    ...c,
    variete: c.variete || map.get(c.CPF) || ''
  }))
}
type FixGeometryResult =
  | { statut: 'ACCEPTE' | 'UNCORRECTABLE' | 'ACCEPTENONCORRIGE' }
  | { statut: 'CORRIGE'; geometry: Polygon }

async function fixGeometry (geometry: Polygon): Promise<FixGeometryResult> {
  const analysis = await repository.analyzeGeometryFix(geometry)

  if (analysis.already_valid) {
    return { statut: 'ACCEPTE' }
  }

  if (!analysis.is_polygon) {
    return { statut: 'UNCORRECTABLE' }
  }

  if (analysis.diff_ha >= 1 || analysis.diff_pct >= 1) {
    return { statut: 'ACCEPTENONCORRIGE' }
  }

  return { statut: 'CORRIGE', geometry: analysis.geometry }
}

async function findHistoryUsers (entries: HistoryEntry[]): Promise<Map<string, CartoBioUser>> {
  const roles = new Map<string, string | null>()
  for (const { user } of entries) {
    if (user && !roles.has(String(user.id))) roles.set(String(user.id), user.mainGroup?.nom ?? null)
  }

  const users = await Promise.all(Array.from(roles, async ([id, role]): Promise<[string, CartoBioUser]> => [id, await getHistoryUser(id, role) as CartoBioUser]))
  return new Map(users)
}

async function withHistoryUsers<T extends { audit_history: HistoryEntry[] }> (record: T): Promise<T> {
  if (!record.audit_history?.length) return record

  return setHistoryUsers(record, await findHistoryUsers(record.audit_history))
}

async function getRecords (numeroBio: string | number) {
  const records = await repository.findRecords(numeroBio)
  const users = await findHistoryUsers(records.flatMap((record) => record.audit_history ?? []))
  return records.map((record) => normalizeRecordSummary(setHistoryUsers(record, users)))
}

async function getRecord (recordId: string, user: CartoBioUser | null = null) {
  const record = await repository.findRecord(recordId)
  if (!record) return null

  const recordWithParcelles = await joinRecordParcelles(record, user?.id)
  return normalizeRecord(await withHistoryUsers(recordWithParcelles))
}

async function joinRecordParcelles (record: DBOperatorRecord, userId: number | null = null) {
  return repository.findRecordParcelles(record, userId)
}

export { createOrUpdateOperatorRecord, notifyCertificationComplete, getRecords, getRecord, joinRecordParcelles, withHistoryUsers }
