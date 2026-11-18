import { polygon } from '@turf/helpers'
import type { Polygon } from 'geojson'
import { db } from '../../database/database.js'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { CertificationState, EventType } from '@agencebio/cartobio-types'
import type {
  CartoBioUser,
  HistoryEntry,
  CartoBioCulture,
  CartoBioFeatureInput,
  CultureInput,
  NormalizedRecord,
  NormalizedRecordSummary
} from '@agencebio/cartobio-types'
import type {
  DBOperatorRecord,
  DBOperatorRecordWithParcelles,
  PreviousParcelle,
  RecordInput
} from './parcellaires.types.js'
import { fetchEmailForNumeroBio } from '../../clients/agence-bio.client.js'
import { sendCertificationComplete } from '../../services/mailer/mailer.service.js'
import { logger } from '../../config/logger.js'
import * as repository from './parcellaires.repository.js'
import { createNewEvent } from '../outputs/history.js'
import { ForbiddenApiError, InvalidRequestApiError, getErrorCode } from '../errors.js'
import { getRandomFeatureId, populateWithMultipleCultures } from '../outputs/features.js'
import { normalizeRecord, normalizeRecordSummary } from '../outputs/record.js'
import { getHistoryUser } from '../../modules/auth/auth.service.js'
import { setHistoryUsers } from './parcellaires.utils.js'
import { isAdmin, isOperatorUser } from '../../modules/auth/auth.utils.js'

/**
 * Create a new record unless we find a dangling one with the same numeroBio and audit date, in which case we update it
 * with the merge algorithm described in ../../docs/rfc/[001-api-parcellaire.md](http://001-api-parcellaire.md)
 */
async function createOrUpdateOperatorRecord(
  record: RecordInput,
  context: {
    user?: CartoBioUser | null
    copyParcellesData?: boolean
    previousRecordId?: string
    fromAPI?: boolean
  } | null = {}
): Promise<DBOperatorRecordWithParcelles> {
  try {
    const { operator, parcelles, shouldNotifyCertification } = await db.transaction(async (tx) => {
      const previousCertificationState = await repository.findCertificationStateAtAuditDate(
        tx,
        record.numerobio,
        record.audit_date
      )

      if (context && previousCertificationState === CertificationState.CERTIFIED) {
        throw new InvalidRequestApiError("Une version certifiée existe déjà à cette date d'audit.")
      }

      let certificationState = record.certification_state || CertificationState.OPERATOR_DRAFT
      if (context?.user && !isAdmin(context.user) && previousCertificationState) {
        certificationState = record.certification_state ?? (previousCertificationState as CertificationState)
        if (isOperatorUser(context.user) && certificationState !== previousCertificationState) {
          throw new ForbiddenApiError("ce changement d'état de certification n'est pas autorisé.")
        }
      }

      let preparedFeatures = await prepareFeatures(record.parcelles.features, tx)

      const previousMap = await loadPreviousFullData(
        tx,
        context,
        record.numerobio ? record.numerobio : '',
        preparedFeatures
      )

      preparedFeatures = applyPreviousData(preparedFeatures, previousMap, context)

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

      const operator = await repository.upsertOperator(tx, record, certificationState, historyEntry)

      const recordId = operator.record_id

      if (operator.certification_state === CertificationState.CERTIFIED) {
        if (!operator.certification_date_debut || !operator.certification_date_fin) {
          throw new InvalidRequestApiError('Les dates de certification sont manquantes.')
        }
      }

      const parcelles = await repository.upsertParcelles(tx, recordId, preparedFeatures)

      await repository.deleteMissingParcelles(tx, recordId, parcelles)

      if (context?.copyParcellesData && context?.previousRecordId) {
        const addedParcelles = await repository.copyParcellesFromPreviousRecord(
          tx,
          recordId,
          operator.numerobio,
          context.previousRecordId
        )
        parcelles.push(...addedParcelles)
      }

      if (record.certification_state === 'CERTIFIED') {
        await repository.updateMixite(tx, recordId)
      }

      const shouldNotifyCertification =
        previousCertificationState !== CertificationState.CERTIFIED &&
        record.certification_state === CertificationState.CERTIFIED

      return { operator, parcelles, shouldNotifyCertification }
    })

    if (shouldNotifyCertification) {
      void notifyCertificationComplete(operator)
    }

    return withHistoryUsers({ ...operator, parcelles })
  } catch (e) {
    if (getErrorCode(e) === '23502') {
      throw new InvalidRequestApiError('La donnée géographique est manquante ou invalide.')
    }

    throw e
  }
}

async function notifyCertificationComplete(record: Parameters<typeof sendCertificationComplete>[0]): Promise<void> {
  try {
    const emails = await fetchEmailForNumeroBio(record.numerobio)
    for (const email of new Set(emails.utilisateurs.map((utilisateur) => utilisateur.email))) {
      const { messageId } = await sendCertificationComplete(record, email)
      logger.info({ messageId, recordId: record.record_id }, 'Mail de certification envoyé')
    }
    await repository.markCertificationNotified(db, String(record.record_id))
  } catch (error) {
    logger.error(
      { err: error },
      `Erreur lors de l'envoi de la notification de certification pour le record ${record.record_id}`
    )
  }
}

async function loadPreviousFullData(
  tx: NodePgDatabase,
  context: { copyParcellesData?: boolean; previousRecordId?: string } | null,
  numerobio: string,
  features: Array<CartoBioFeatureInput>
): Promise<Map<string | number, PreviousParcelle>> {
  if (!context?.copyParcellesData || !context?.previousRecordId) {
    return new Map()
  }

  const previousMap = new Map<string | number, PreviousParcelle>()
  const located = features.filter((feature) => feature.id && feature.geometry)
  const previous = await repository.findMatchingPreviousParcelles(
    tx,
    numerobio,
    context.previousRecordId,
    located.map((feature) => feature.geometry)
  )

  located.forEach((feature, index) => {
    const match = previous[index]
    if (feature.id && match) previousMap.set(feature.id, match)
  })

  return previousMap
}

async function prepareFeatures(
  features: Array<CartoBioFeatureInput>,
  tx: NodePgDatabase
): Promise<Array<CartoBioFeatureInput>> {
  const prepared = features.map((feature) =>
    populateWithMultipleCultures(feature.id ? feature : { ...feature, id: getRandomFeatureId() })
  )
  const withGeometry = prepared.filter((feature) => feature.geometry)
  const analyses = await repository.analyzeGeometries(
    tx,
    withGeometry.map((feature) => ({
      geometry: feature.geometry as Polygon,
      commune: feature.properties.COMMUNE
    }))
  )
  const analysisByFeature = new Map(withGeometry.map((feature, index) => [feature, analyses[index]]))

  return prepared.map((feature) => {
    const analysis = analysisByFeature.get(feature)
    if (!analysis) return feature

    if (analysis.statut === 'UNCORRECTABLE') {
      const featureLabel =
        feature.properties.NUMERO_I && feature.properties.NUMERO_P
          ? `îlot ${feature.properties.NUMERO_I} parcelle ${feature.properties.NUMERO_P}`
          : feature.properties.NOM || feature.id
      throw new InvalidRequestApiError(`Une géométrie n'est pas corrigeable (${featureLabel})`)
    }

    const result =
      analysis.statut === 'CORRIGE' && analysis.geometry
        ? polygon(analysis.geometry.coordinates, feature.properties, { id: feature.id })
        : feature

    result.properties.statut_import_geom = analysis.statut
    result.properties.etranger = analysis.etranger ?? false
    result.properties.COMMUNE = analysis.commune

    return result
  })
}

function applyPreviousData(
  features: Array<CartoBioFeatureInput>,
  previousMap: Map<string | number, PreviousParcelle>,
  context: { copyParcellesData?: boolean } | null
): Array<CartoBioFeatureInput> {
  if (!context?.copyParcellesData) return features

  return features.map((f) => {
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

        engagement_date: f.properties.engagement_date || prev.engagement_date,

        NOM: f.properties.NOM || prev.name
      }
    }
  })
}

function mergeCulturesExact(
  newCultures: Array<CultureInput> = [],
  oldCultures: Array<CartoBioCulture> = []
): Array<CultureInput> {
  const map = new Map()

  for (const newC of newCultures) {
    const cpf = newC.CPF

    const varietes = oldCultures.filter((o) => o.CPF === cpf && o.variete).map((o) => o.variete)

    if (varietes.length) {
      map.set(cpf, Array.from(new Set(varietes)).join('; '))
    }
  }

  return newCultures.map((c) => ({
    ...c,
    variete: c.variete || map.get(c.CPF) || ''
  }))
}

async function findHistoryUsers(entries: HistoryEntry[]): Promise<Map<string, CartoBioUser>> {
  const roles = new Map<string, string | null>()
  for (const { user } of entries) {
    if (user && !roles.has(String(user.id))) roles.set(String(user.id), user.mainGroup?.nom ?? null)
  }

  const users = await Promise.all(
    Array.from(roles, async ([id, role]): Promise<[string, CartoBioUser]> => [
      id,
      await getHistoryUser(id, role).then(({ id, nom, prenom, mainGroup, organismeCertificateur }) => ({
        id,
        nom,
        prenom,
        groups: [],
        mainGroup: { nom: mainGroup.nom },
        ...(organismeCertificateur ? { organismeCertificateur } : {})
      }))
    ])
  )
  return new Map(users)
}

async function withHistoryUsers<T extends { audit_history: HistoryEntry[] }>(record: T): Promise<T> {
  if (!record.audit_history?.length) return record

  return setHistoryUsers(record, await findHistoryUsers(record.audit_history))
}

async function getRecords(numeroBio: string | number): Promise<NormalizedRecordSummary[]> {
  const records = await repository.findRecords(numeroBio)
  const users = await findHistoryUsers(records.flatMap((record) => record.audit_history ?? []))
  return records.map((record) => normalizeRecordSummary(setHistoryUsers(record, users)))
}

async function getRecord(recordId: string, user: CartoBioUser | null = null): Promise<NormalizedRecord | null> {
  const record = await repository.findRecord(db, recordId)
  if (!record) return null

  const recordWithParcelles = await joinRecordParcelles(record, user?.id)
  return normalizeRecord(await withHistoryUsers(recordWithParcelles))
}

async function joinRecordParcelles(
  record: DBOperatorRecord,
  userId: number | null = null
): Promise<DBOperatorRecordWithParcelles> {
  return repository.findRecordParcelles(record, userId)
}

export {
  createOrUpdateOperatorRecord,
  notifyCertificationComplete,
  getRecords,
  getRecord,
  joinRecordParcelles,
  withHistoryUsers
}
