import { CertificationState, EventType, toIsoDateTime } from '@agencebio/cartobio-types'
import type { CartoBioUser, NormalizedRecord, HistoryEntry } from '@agencebio/cartobio-types'
import { isAdmin } from '../../modules/auth/auth.utils.js'

function isAfterCertificationState(referenceState: CertificationState) {
  const stateValues = Object.values(CertificationState)
  const lookupIndex = stateValues.indexOf(referenceState)

  return function isCandidate(lookup: string | undefined) {
    return stateValues.indexOf(lookup as CertificationState) >= lookupIndex
  }
}

const hasBeenAudited = isAfterCertificationState(CertificationState.AUDITED)

const EventTypeRules: Array<(event: { eventType: EventType; record: NormalizedRecord }) => boolean> = [
  // [*] Import/création du parcellaire
  ({ eventType: type }) => type === EventType.FEATURE_COLLECTION_CREATE,
  // [*] Suppression du parcellaire
  ({ eventType: type }) => type === EventType.FEATURE_COLLECTION_DELETE,
  // [AUDITED] Ajout de parcelle
  ({ eventType: type, record }) => type === EventType.FEATURE_CREATE && hasBeenAudited(record.certification_state),
  // [AUDITED] Suppression de parcelle
  ({ eventType: type, record }) => type === EventType.FEATURE_DELETE && hasBeenAudited(record.certification_state),
  // [*] Terminer l’audit
  // [*] Envoi du parcellaire pour certification
  // [*] Certification du parcellaire
  ({ eventType: type }) => type === EventType.CERTIFICATION_STATE_CHANGE,
  // [AUDITED] Changement sur le parcellaire
  ({ eventType: type, record }) => type === EventType.FEATURE_UPDATE && hasBeenAudited(record.certification_state),
  ({ eventType: type, record }) =>
    type === EventType.FEATURE_COLLECTION_UPDATE && hasBeenAudited(record.certification_state)
]

/**
 * Determine if a new HistoryEntry should be created
 */
function shouldCreateHistoryEvent({ record, eventType }: { record: NormalizedRecord; eventType: EventType }): boolean {
  return EventTypeRules.some((rule) => rule({ record, eventType }))
}

type NewEventPayload = {
  description?: string
  state?: string
  metadata?: Record<string, unknown>
  features?: Parameters<typeof collectFeatureIdsFromPayload>[0]
  date?: Date
}
/**
 * Create a new Event if necessary
 */
function createNewEvent(
  eventType: EventType,
  payload: NewEventPayload,
  context: { user?: CartoBioUser | null; record: null }
): HistoryEntry
function createNewEvent(
  eventType: EventType,
  payload: NewEventPayload,
  context: { user?: CartoBioUser | null; record: NormalizedRecord | null }
): HistoryEntry | null
function createNewEvent(
  eventType: EventType,
  payload: NewEventPayload,
  { user, record }: { user?: CartoBioUser | null; record: NormalizedRecord | null }
): HistoryEntry | null {
  const { features, date, ...event } = payload
  if (!record || !user || shouldCreateHistoryEvent({ record, eventType })) {
    return {
      type: eventType,
      ...event,
      ...(features ? { featureIds: collectFeatureIdsFromPayload(features) } : {}),
      date: toIsoDateTime(date || new Date()),
      ...(user ? { user } : {})
    }
  }

  return null
}

function collectFeatureIdsFromPayload(
  payload: Array<{ id?: string | number }> | { features?: Array<{ id?: string | number }> } | null | undefined
): Array<string | number | undefined> | null {
  const features = Array.isArray(payload) ? payload : payload?.features
  return Array.isArray(features) ? features.map(({ id }) => id) : null
}

type HistoryViewer = { user?: CartoBioUser | null; ocId?: number | null }

function maskOcAgents<T extends object>(record: T, viewer: HistoryViewer, currentOcId?: number | null): T {
  const history = (record as { audit_history?: HistoryEntry[] | null }).audit_history
  if (!history?.length || isAdmin(viewer.user)) return record

  return {
    ...record,
    audit_history: history.map((entry) => {
      const agentOc = entry.user?.organismeCertificateur
      if (!entry.user || !agentOc || agentOc.id === currentOcId || agentOc.id === viewer.ocId) return entry

      return {
        ...entry,
        user: {
          id: 0,
          nom: agentOc.nom,
          prenom: '',
          groups: [],
          mainGroup: entry.user.mainGroup,
          organismeCertificateur: agentOc
        }
      }
    })
  }
}

export { EventType, collectFeatureIdsFromPayload, createNewEvent, maskOcAgents }
