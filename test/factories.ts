import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import type { Mock } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CertificationState } from '@agencebio/cartobio-types'
import type { AgenceBioAdresses, AgenceBioNormalizedOperator, AgenceBioNotification, AgenceBioOperator, CartoBioCulture, CartoBioFeature, CartoBioFeatureProperties, CartoBioOCUser, CartoBioUser, DBOperatorRecordWithParcelles, DBParcelle, NormalizedRecord } from '@agencebio/cartobio-types'
import type { createOrUpdateOperatorRecord } from '../src/shared/parcellaires/parcellaires.service.js'
import pool from '../src/database/database.js'
import type { PdfParcelle } from '../src/modules/exports/exports.repository.js'
import type { Browser, Page } from 'puppeteer'
import type { PDFDocument } from 'pdf-lib'
import type { FastifyRequest } from 'fastify'

export function mockedQuery () {
  return pool.query as unknown as Mock<(...args: unknown[]) => Promise<QueryResult<QueryResultRow>>>
}

export function queryResult<R extends QueryResultRow> (rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] }
}

export function buildOperator (overrides: Partial<AgenceBioNormalizedOperator> = {}): AgenceBioNormalizedOperator {
  return {
    id: 1,
    nom: 'Opérateur de test',
    denominationCourante: '',
    siret: '',
    numeroBio: '99999',
    numeroPacage: null,
    email: '',
    dateEngagement: new Date('2023-01-01'),
    datePremierEngagement: new Date('2023-01-01'),
    organismeCertificateur: {},
    adressesOperateurs: [],
    codeCommune: '',
    departement: '',
    commune: '',
    codePostal: '',
    notifications: null,
    isProduction: true,
    ...overrides
  }
}

export function buildPdfParcelle (overrides: Partial<PdfParcelle> = {}): PdfParcelle {
  return {
    id: '1',
    name: null,
    cultures: [],
    conversion_niveau: 'AB',
    commune: null,
    communename: 'inconnu',
    created: null,
    engagement_date: null,
    nbilot: null,
    nbp: null,
    refcad: null,
    geojson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }),
    minx: 0,
    miny: 0,
    maxx: 1,
    maxy: 1,
    centerx: 0.5,
    centery: 0.5,
    superficie_totale_ha: 0,
    ...overrides
  }
}

export const asPage = (mock: Record<string, Mock>) => mock as unknown as Page
export const asBrowser = (mock: Record<string, Mock>) => mock as unknown as Browser
export const asPdfDocument = (mock: Record<string, Mock>) => mock as unknown as PDFDocument
export const asFastifyRequest = (mock: object) => mock as FastifyRequest

export function buildCulture (overrides: Partial<CartoBioCulture> = {}): CartoBioCulture {
  return {
    id: randomUUID(),
    CPF: '01.19.10.8',
    ...overrides
  }
}

export function buildUser (overrides: Partial<CartoBioUser> = {}): CartoBioUser {
  return {
    id: 1,
    prenom: 'test',
    nom: 'test',
    groups: [{ id: '4', nom: 'Opérateur' }],
    mainGroup: { id: '4', nom: 'Opérateur' },
    ...overrides
  }
}

export function buildOcUser (overrides: Partial<CartoBioOCUser> = {}): CartoBioOCUser {
  return {
    id: 1,
    prenom: 'test',
    nom: 'test',
    organismeCertificateur: { id: 1, nom: "CartoBi'OC" },
    groups: [{ id: '1', nom: 'Auditeur' }, { id: '2', nom: 'Chargé de certification' }],
    mainGroup: { id: '1', nom: 'Auditeur' },
    ...overrides
  }
}

type RecordInput = Parameters<typeof createOrUpdateOperatorRecord>[0]
export const asRecordInput = (fixture: object) => fixture as RecordInput
export const asDBRecordWithParcelles = (fixture: object) => fixture as DBOperatorRecordWithParcelles
export const asNormalizedRecord = (fixture: object) => fixture as NormalizedRecord
export const asAgenceBioOperator = (fixture: object) => fixture as AgenceBioOperator

export const asMockedDatabase = (database: object) => database as { _clientRelease: Mock }

export const asPoolClient = (database: object) => database as PoolClient

export const asGotRequest = <T> (mock: Record<string, Mock>) => mock as unknown as T

export function buildDBParcelle (overrides: Partial<DBParcelle> = {}): DBParcelle {
  return {
    record_id: randomUUID(),
    id: '1',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    cultures: [],
    conversion_niveau: 'AB',
    etranger: false,
    ...overrides
  }
}

export function buildNotification (overrides: Partial<AgenceBioNotification> = {}): AgenceBioNotification {
  return {
    id: 1,
    etatCertification: '',
    status: '',
    organismeCertificateurId: null,
    organisme: null,
    activites: [],
    ...overrides
  }
}

export function buildAgenceBioOperator (overrides: Partial<AgenceBioOperator> = {}): AgenceBioOperator {
  return {
    id: 1,
    nom: 'Opérateur de test',
    denominationCourante: '',
    siret: '',
    echeanceSiret: '',
    flag: '',
    numeroBio: '99999',
    echangeSiret: '',
    email: '',
    gerant: '',
    telephone: '',
    telephoneCommerciale: '',
    numeroPacage: '',
    dateFinConversion: '',
    lat: 0,
    long: 0,
    mandate: false,
    dateMaj: new Date('2023-01-01'),
    dateEngagement: new Date('2023-01-01'),
    datePremierEngagement: new Date('2023-01-01'),
    codeNAF: '',
    reseauId: 0,
    departementId: 0,
    photo: [],
    sitesWeb: [],
    notifications: [],
    adressesOperateurs: [],
    ...overrides
  }
}

export function buildAdresse (overrides: Partial<AgenceBioAdresses> = {}): AgenceBioAdresses {
  return {
    active: true,
    lat: 0,
    long: 0,
    codeCommune: '',
    lieu: '',
    dates: '',
    codePostal: '',
    ville: '',
    ...overrides
  }
}

export function buildFeature (overrides: Partial<CartoBioFeature> & { properties?: Partial<CartoBioFeatureProperties> } = {}): CartoBioFeature {
  const { properties, ...feature } = overrides
  return {
    type: 'Feature',
    id: '1',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    ...feature,
    properties: {
      cultures: [],
      conversion_niveau: 'AB',
      ...properties
    }
  }
}

export function buildNormalizedRecord (overrides: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    record_id: randomUUID(),
    numerobio: '99999',
    version_name: 'Version de test',
    annee_reference_controle: null,
    certification_state: CertificationState.OPERATOR_DRAFT,
    created_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z',
    oc_label: null,
    metadata: {},
    audit_history: [],
    audit_demandes: null,
    parcelles: { type: 'FeatureCollection', features: [] },
    ...overrides
  }
}
