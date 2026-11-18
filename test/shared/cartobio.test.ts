import { createOrUpdateOperatorRecord, getRecord } from '../../src/shared/parcellaires/parcellaires.service.js'
import { pinOperator, unpinOperator, consultOperator, searchControlBodyRecords, getPinnedOperators } from '../../src/modules/operators/operators.service.js'
import { markFeatureControlled, markFeatureUncontrolled, updateAuditRecordState, deleteSingleFeature, updateFeature } from '../../src/modules/audits/audits.service.js'
import { get, HTTPError, TimeoutError } from '../got-mock.js'
import { NotFoundApiError } from '../../src/shared/errors.js'
import _records from '../fixtures/providers/records.json' with { type: 'json' }
const [record] = _records
import records from '../fixtures/providers/records.json' with { type: 'json' }
import recordToUpdate from '../fixtures/providers/records-to-update.json' with { type: 'json' }
import parcelles from '../fixtures/providers/parcelles.json' with { type: 'json' }
import otherParcelles from '../fixtures/providers/parcelles-aquacole-frontaliere.json' with { type: 'json' }
/** TMP */
import agencebioOperatorsApiResults from '../fixtures/providers/agence-bio-operateur-for-search.json' with { type: 'json' }
import { evvClient, evvLookup, evvParcellaire } from '../../src/modules/imports/imports.service.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizeRecord } from '../../src/shared/outputs/record.js'
import { eq, sql } from 'drizzle-orm'
import db, { db as drizzleDb } from '../../src/database/database.js'
import * as schema from '../../src/database/schema/index.js'
import { upsertCultures } from '../../src/shared/parcellaires/parcellaires.repository.js'
import { loadRecordFixture } from '../utils.js'
import { EtatProduction, CertificationState } from '@agencebio/cartobio-types'
import { randomUUID } from 'crypto'
import { getConsultedOperators } from '../../src/modules/operators/operators.service.js'
import * as mailer from '../../src/services/mailer/utils.js'
import { fetchEmailForNumeroBio } from '../../src/clients/agence-bio.client.js'
import type { AgenceBioNormalizedOperatorWithRecord, DeleteFeatureBody, FeaturePropertiesInput } from '@agencebio/cartobio-types'
import { asDBRecordWithParcelles, asGotRequest, asNormalizedRecord, asRecordInput, buildOcUser, buildOperator, buildUser } from '../factories.js'

type FixtureFeature = { type: 'Feature'; id: unknown; geometry: unknown; properties: Record<string, unknown> }

const user = buildOcUser()
type WithMaxAuditDate = AgenceBioNormalizedOperatorWithRecord & { max_audit_date?: string | null }

const normalizedRecord = normalizeRecord(asDBRecordWithParcelles({
  ...record,
  parcelles
}))

const xmlEvv = readFileSync(join(import.meta.dirname, '../fixtures/providers/cvi-evv.xml'), { encoding: 'utf8' })
const xmlParcellaire = readFileSync(join(import.meta.dirname, '../fixtures/providers/cvi-parcellaire.xml'), { encoding: 'utf8' })

vi.mock('../../src/services/mailer/utils.js', () => ({
  sendCertificationComplete: vi.fn()
}))

vi.mock('../../src/clients/agence-bio.client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchEmailForNumeroBio: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mailer.sendCertificationComplete).mockResolvedValue(() => ({ messageId: 'test' }))
  vi.mocked(fetchEmailForNumeroBio).mockResolvedValue({
    numerobio: '123',
    utilisateurs: [{ email: 'test@test.fr' }]
  })
})

describe('updateFeature', () => {
  afterEach(async () => {
    await drizzleDb.delete(schema.parcellaires).where(eq(schema.parcellaires.numeroBio, Number(record.numerobio)))
  })

  test('successfully update feature', async () => {
    await loadRecordFixture()

    const featureId = 1
    const properties: FeaturePropertiesInput = {
      commune: '26108',
      conversion_niveau: 'AB',
      engagement_date: '2015-01-01',
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2',
      cultures: [
        {
          id: '0f9a4b52-6f1d-4a39-9d36-1c8a2b7e5d10',
          commentaire: 'commentaire parcelle',
          CPF: '01.19.10.8',
          surface: 25,
          unit: '%',
          date_semis: '2022-03-24',
          variete: 'rouge bleue'
        }
      ]
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user }, { properties })
    expect(result).toMatchObject({
      record_id: record.record_id,
      version_name: record.version_name,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
    expect(result.audit_history).toHaveLength(2)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0]).toMatchObject(properties)
  })

  test('set OC if record has no OC', async () => {
    const tmpRecords: Record<string, unknown> = record

    tmpRecords.oc_id = null
    await loadRecordFixture([tmpRecords])

    const featureId = 1
    const properties = {
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2'
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user }, { properties })
    Object.freeze(result)
    expect(result).toMatchObject({
      record_id: record.record_id,
      version_name: record.version_name,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata,
      oc_id: user.organismeCertificateur.id
    })
    expect(result.audit_history).toHaveLength(2)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0]).toMatchObject(properties)
  })

  test('set OC from operator if record has no OC', async () => {
    const tmpRecords: Record<string, unknown> = record

    tmpRecords.oc_id = null
    await loadRecordFixture([tmpRecords])

    const featureId = 1
    const properties = {
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2'
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user: null, operator: buildOperator({ organismeCertificateur: user.organismeCertificateur }) }, { properties })

    expect(result).toMatchObject({
      record_id: record.record_id,
      version_name: record.version_name,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata,
      oc_id: user.organismeCertificateur.id
    })
    expect(result.audit_history).toHaveLength(2)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0]).toMatchObject(properties)
  })

  test('doest not set OC if user has no OC', async () => {
    const tmpRecords: Record<string, unknown> = record

    tmpRecords.oc_id = null
    await loadRecordFixture([tmpRecords])

    const tmpUser = { ...user }

    delete (tmpUser as Partial<typeof tmpUser>).organismeCertificateur

    const featureId = 1
    const properties = {
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2'
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user: tmpUser }, { properties })

    expect(result).toMatchObject({
      record_id: record.record_id,
      version_name: record.version_name,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata,
      oc_id: null
    })
    expect(result.audit_history).toHaveLength(2)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0]).toMatchObject(properties)
  })
})

describe('deleteSingleFeature', () => {
  beforeEach(() => loadRecordFixture())

  const featureId = 1
  const reason: DeleteFeatureBody['reason'] = {
    code: 'other',
    details: 'parce que'
  }

  test('successfully removes a given feature based on its id', async () => {
    const result = await deleteSingleFeature({ featureId, record: normalizedRecord, user }, { reason })

    expect(result).toMatchObject({
      record_id: record.record_id,
      version_name: record.version_name,
      annee_reference_controle: record.annee_reference_controle,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
    expect(result.audit_history).toHaveLength(2)
    expect(result.parcelles).toHaveLength(2)
  })

  test('throws an error when trying to remove a non-existing feature', async () => {
    await expect(deleteSingleFeature({ featureId: 9999, record: normalizedRecord, user }, { reason })).rejects.toThrow(NotFoundApiError)
    expect(db.connect).not.toHaveBeenCalled()
  })
})

describe('createOrUpdateOperatorRecord', () => {
  beforeEach(async () => {
    await loadRecordFixture([recordToUpdate])
  })

  afterEach(async () => {
    await drizzleDb.delete(schema.parcellaires).where(eq(schema.parcellaires.numeroBio, Number(recordToUpdate.numerobio)))
  })

  test('returns an explicit error code when a new feature has no geometry', async () => {
    const featureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'without-geometry',
        geometry: null,
        properties: {}
      }]
    }

    await expect(createOrUpdateOperatorRecord(
      asRecordInput({ ...recordToUpdate, parcelles: featureCollection }),
      { user },
      drizzleDb
    )).rejects.toMatchObject({ code: 'MISSING_GEOMETRY' })
  })

  test('successfully update a record without data from previous record', async () => {
    const record: Record<string, unknown> = recordToUpdate

    // Data we don't want to copy
    await upsertCultures(drizzleDb, record.record_id as string, parcelles[0].id, [{"id": "1", "CPF": "123", "variete": "VARIETE DIFFERENTE"}])

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }

    for (const parcelle of parcelles) {
      featureCollection.features.push(/** @type {Feature} */{
        type: 'Feature',
        id: parcelle.id,
        geometry: parcelle.geometry,
        properties: {
          id: parcelle.id,
          BIO: 1,
          cultures: parcelle.cultures,
          conversion_niveau: EtatProduction.BIO,
          NUMERO_I: '1',
          NUMERO_P: '2',
          PACAGE: ' 3'
        }
      })
    }

    featureCollection.features[0].properties.cultures = [
      {
        id: 1,
        CPF: '123'
      }
    ]

    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, parcelles: featureCollection }),
      { user, copyParcellesData: false, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result).toMatchObject({
      record_id: record.record_id,
      version_name: record.version_name,
      annee_reference_controle: record.annee_reference_controle,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
    expect(result.audit_history).toHaveLength(2)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0].cultures[0].variete).toBeUndefined()
  })

  test('successfully create a record and add annee reference from audit date', async () => {
    const record: Record<string, unknown> = { ...recordToUpdate }

    record.annee_reference_controle = ''

    // To avoid ON CONFLICT condition
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 12)
    await drizzleDb.update(schema.parcellaires).set({ auditDate: sql`${pastDate.toISOString()}::date`, createdAt: pastDate }).where(eq(schema.parcellaires.recordId, record.record_id as string))

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }
    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, parcelles: featureCollection }),
      { user, copyParcellesData: false, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result).toMatchObject({
      version_name: record.version_name,
      annee_reference_controle: 2024,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
  })

  test('successfully create a record and add annee reference from creation date if record has no audit date', async () => {
    const record: Record<string, unknown> = { ...recordToUpdate }

    record.annee_reference_controle = ''
    record.audit_date = ''

    // To avoid ON CONFLICT condition
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 12)
    await drizzleDb.update(schema.parcellaires).set({ auditDate: sql`${pastDate.toISOString()}::date`, createdAt: pastDate }).where(eq(schema.parcellaires.recordId, record.record_id as string))

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }
    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, parcelles: featureCollection }),
      { user, copyParcellesData: false, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result).toMatchObject({
      version_name: record.version_name,
      annee_reference_controle: new Date().getFullYear(),
      numerobio: record.numerobio,
      audit_date: null,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
  })

  test('successfully create a record with data from previous record', async () => {
    const record: Record<string, unknown> = recordToUpdate

    // Data we want to copy
    await upsertCultures(drizzleDb, record.record_id as string, parcelles[0].id, [{"id": "1", "CPF": "123", "variete": "VARIETE DIFFERENTE"}])

    // To avoid ON CONFLICT condition
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await drizzleDb.update(schema.parcellaires).set({ auditDate: sql`${yesterday.toISOString()}::date`, createdAt: yesterday }).where(eq(schema.parcellaires.recordId, record.record_id as string))

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }

    for (const parcelle of parcelles) {
      featureCollection.features.push(/** @type {Feature} */{
        type: 'Feature',
        id: parcelle.id,
        geometry: parcelle.geometry,
        properties: {
          id: parcelle.id,
          BIO: 1,
          cultures: parcelle.cultures,
          conversion_niveau: EtatProduction.BIO,
          NUMERO_I: '1',
          NUMERO_P: '2',
          PACAGE: ' 3'
        }
      })
    }

    featureCollection.features[0].properties.cultures = [
      {
        id: 1,
        CPF: '123'
      }
    ]

    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, record_id: randomUUID(), parcelles: featureCollection }),
      { user, copyParcellesData: true, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result).toMatchObject({
      version_name: record.version_name,
      annee_reference_controle: record.annee_reference_controle,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
    expect(result.audit_history).toHaveLength(1)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0].cultures[0].variete).toEqual('VARIETE DIFFERENTE')
    expect(result.parcelles[1].cultures[0].variete).toEqual(parcelles[1].cultures[0].variete)
  })

  test('successfully create a record without data from previous record', async () => {
    const record: Record<string, unknown> = recordToUpdate

    // To avoid ON CONFLICT condition
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await drizzleDb.update(schema.parcellaires).set({ auditDate: sql`${yesterday.toISOString()}::date`, createdAt: yesterday }).where(eq(schema.parcellaires.recordId, record.record_id as string))

    // Data we don't want to copy
    await upsertCultures(drizzleDb, record.record_id as string, parcelles[0].id, [{"id": "1", "CPF": "123", "variete": "VARIETE DIFFERENTE"}])

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }

    for (const parcelle of parcelles) {
      featureCollection.features.push(/** @type {Feature} */{
        type: 'Feature',
        id: parcelle.id,
        geometry: parcelle.geometry,
        properties: {
          id: parcelle.id,
          BIO: 1,
          cultures: parcelle.cultures,
          conversion_niveau: EtatProduction.BIO,
          NUMERO_I: '1',
          NUMERO_P: '2',
          PACAGE: ' 3'
        }
      })
    }

    featureCollection.features[0].properties.cultures = [
      {
        id: 1,
        CPF: '123'
      }
    ]

    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, parcelles: featureCollection }),
      { user, copyParcellesData: false, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result).toMatchObject({
      version_name: record.version_name,
      annee_reference_controle: record.annee_reference_controle,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
    expect(result.audit_history).toHaveLength(1)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0].cultures[0].variete).toBeUndefined()
    expect(result.parcelles[1].cultures[0].variete).toEqual(parcelles[1].cultures[0].variete)
  })

  test('successfully update a record with data from previous record with multiple same culture CPF', async () => {
    const record: Record<string, unknown> = recordToUpdate
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    for (const { recordId } of await drizzleDb.select({ recordId: schema.parcelles.recordId }).from(schema.parcelles).where(eq(schema.parcelles.id, parcelles[0].id))) {
      await upsertCultures(drizzleDb, recordId, parcelles[0].id, [{"id": "1", "CPF": "123", "variete": "VARIETE 1"}, {"id": "2", "CPF": "123", "variete": "VARIETE 2"}])
    }
    await drizzleDb.update(schema.parcellaires).set({ auditDate: sql`${yesterday.toISOString()}::date`, createdAt: yesterday }).where(eq(schema.parcellaires.recordId, record.record_id as string))

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }

    for (const parcelle of parcelles) {
      featureCollection.features.push(/** @type {Feature} */{
        type: 'Feature',
        id: parcelle.id,
        geometry: parcelle.geometry,
        properties: {
          id: parcelle.id,
          BIO: 1,
          cultures: parcelle.cultures,
          conversion_niveau: EtatProduction.BIO,
          NUMERO_I: '1',
          NUMERO_P: '2',
          PACAGE: ' 3'
        }
      })
    }

    featureCollection.features[0].properties.cultures = [
      {
        id: 1,
        CPF: '123'
      }
    ]

    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, parcelles: featureCollection }),
      { user, copyParcellesData: true, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result).toMatchObject({
      version_name: record.version_name,
      annee_reference_controle: record.annee_reference_controle,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
    expect(result.audit_history).toHaveLength(1)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0].cultures[0].variete).toEqual('VARIETE 1; VARIETE 2')
    expect(result.parcelles[1].cultures[0].variete).toEqual(parcelles[1].cultures[0].variete)
  })

  test('successfully update a record with data from previous record with no variety', async () => {
    const record: Record<string, unknown> = recordToUpdate
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    await upsertCultures(drizzleDb, record.record_id as string, parcelles[0].id, [{"id": "1", "CPF": "123"}])
    await drizzleDb.update(schema.parcellaires).set({ auditDate: sql`${yesterday.toISOString()}::date`, createdAt: yesterday }).where(eq(schema.parcellaires.recordId, record.record_id as string))

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }

    for (const parcelle of parcelles) {
      featureCollection.features.push(/** @type {Feature} */{
        type: 'Feature',
        id: parcelle.id,
        geometry: parcelle.geometry,
        properties: {
          id: parcelle.id,
          BIO: 1,
          cultures: parcelle.cultures,
          conversion_niveau: EtatProduction.BIO,
          NUMERO_I: '1',
          NUMERO_P: '2',
          PACAGE: ' 3'
        }
      })
    }

    featureCollection.features[0].properties.cultures = [
      {
        id: 1,
        CPF: '123'
      }
    ]

    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, parcelles: featureCollection }),
      { user, copyParcellesData: true, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result).toMatchObject({
      version_name: record.version_name,
      annee_reference_controle: record.annee_reference_controle,
      numerobio: record.numerobio,
      audit_date: record.audit_date,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
    expect(result.audit_history).toHaveLength(1)
    expect(result.parcelles).toHaveLength(3)
    expect(result.parcelles[0].cultures[0].variete).toBeUndefined()
    expect(result.parcelles[1].cultures[0].variete).toEqual(parcelles[1].cultures[0].variete)
  })

  test('commune are found with update_communes trigger', async () => {
    const record: Record<string, unknown> = recordToUpdate

    const featureCollection = {
      type: 'FeatureCollection',
      features: [] as FixtureFeature[]
    }

    for (const parcelle of parcelles) {
      featureCollection.features.push(/** @type {Feature} */{
        type: 'Feature',
        id: parcelle.id,
        geometry: parcelle.geometry,
        properties: {
          id: parcelle.id,
          COMMUNE: null
        }
      })
    }

    // Existing parcelle commune should not be overridden
    featureCollection.features.push(/** @type {Feature} */{
      type: 'Feature',
      id: 1,
      geometry: otherParcelles[0].geometry,
      properties: {
        id: 1,
        COMMUNE: null
      }
    })

    for (const parcelle of otherParcelles) {
      featureCollection.features.push(/** @type {Feature} */{
        type: 'Feature',
        id: parcelle.id,
        geometry: parcelle.geometry,
        properties: {
          id: parcelle.id,
          COMMUNE: null
        }
      })
    }

    const result = await createOrUpdateOperatorRecord(
      asRecordInput({ ...record, parcelles: featureCollection }),
      { user, copyParcellesData: false, previousRecordId: record.record_id as string },
      drizzleDb
    )

    expect(result.parcelles).toHaveLength(6)
    expect(result.parcelles[0].commune).toEqual('26108')
    expect(result.parcelles[0].etranger).toEqual(false)
    expect(result.parcelles[1].commune).toEqual('12266')
    expect(result.parcelles[1].etranger).toEqual(false)
    expect(result.parcelles[2].commune).toEqual('70278')
    expect(result.parcelles[2].etranger).toEqual(false)
    expect(result.parcelles[3].commune).toEqual('59183')
    expect(result.parcelles[3].etranger).toEqual(false)
    expect(result.parcelles[4].commune).toEqual('59183')
    expect(result.parcelles[4].etranger).toEqual(false)
    expect(result.parcelles[5].commune).toBeNull()
    expect(result.parcelles[5].etranger).toEqual(true)
  })
})

describe('updateAuditRecordState', () => {
  afterEach(async () => {
    await drizzleDb.delete(schema.parcellaires).where(eq(schema.parcellaires.numeroBio, Number(recordToUpdate.numerobio)))
  })

  test('successfully update version name', async () => {
    const record: Record<string, unknown> = recordToUpdate
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record: asNormalizedRecord(record) },
      { version_name: 'Nouveau nom de version' }
    )
    expect(result).toMatchObject({
      version_name: 'Nouveau nom de version'
    })
  })

  test('successfully update certification state to PENDING_CERTIFICATION', async () => {
    const record: Record<string, unknown> = recordToUpdate
    record.certification_state = CertificationState.OPERATOR_DRAFT
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record: asNormalizedRecord(record) },
      { certification_state: CertificationState.PENDING_CERTIFICATION }
    )
    expect(result).toMatchObject({
      certification_state: CertificationState.PENDING_CERTIFICATION
    })
  })

  test('successfully update certification state to AUDITED', async () => {
    const record: Record<string, unknown> = recordToUpdate
    record.audit_date = null
    record.certification_state = CertificationState.OPERATOR_DRAFT
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record: asNormalizedRecord(record) },
      { certification_state: CertificationState.AUDITED }
    )
    expect(result.certification_state).toEqual(CertificationState.AUDITED)
    expect(result.audit_date).toEqual(new Date().toISOString().substring(0, 10))
  })

  test('successfully update certification state to AUDITED and set given audit_date', async () => {
    const record: Record<string, unknown> = recordToUpdate
    record.audit_date = null
    record.certification_state = CertificationState.OPERATOR_DRAFT
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record: asNormalizedRecord(record) },
      { certification_state: CertificationState.AUDITED, audit_date: '2024-12-01' }
    )
    expect(result.certification_state).toEqual(CertificationState.AUDITED)
    expect(result.audit_date).toEqual('2024-12-01')
  })

  test('successfully set user oc_id if record oc_id is null', async () => {
    const record: Record<string, unknown> = recordToUpdate
    record.oc_id = null

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record: asNormalizedRecord(record) },
      { version_name: 'Attribution OC' }
    )
    expect(result).toMatchObject({
      version_name: 'Attribution OC',
      oc_id: user.organismeCertificateur.id
    })
  })

  test('successfully set operator oc_id if record oc_id is null', async () => {
    const record: Record<string, unknown> = recordToUpdate
    record.oc_id = null

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user: buildUser({ mainGroup: { id: '1', nom: 'Auditeur' } }), record: asNormalizedRecord(record), operator: buildOperator({ organismeCertificateur: { id: 10, nom: 'Test' } }) },
      { version_name: 'Attribution OC' }
    )
    expect(result).toMatchObject({
      version_name: 'Attribution OC',
      oc_id: 10
    })
  })

  test('throw if not the correct OC', async () => {
    const record: Record<string, unknown> = recordToUpdate
    record.oc_id = 2

    await loadRecordFixture([record])

    await expect(updateAuditRecordState(
      { user, record: asNormalizedRecord(record) },
      { version_name: 'Attribution OC' }
    )).rejects.toThrow()
  })
})

describe('evvLookup', () => {
  test('returns a known operator', () => {
    expect.assertions(1)
    vi.mocked(evvClient.get).mockReturnValueOnce(asGotRequest({ text: vi.fn().mockResolvedValue(xmlEvv) }))

    const result = evvLookup({ numeroEvv: '01234' })

    return expect(result).resolves.toEqual({ siret: '999999999', libelle: 'test viti', numero: '01234' })
  })

  test('operator not found', () => {
    expect.assertions(1)
    vi.mocked(evvClient.get).mockReturnValueOnce(asGotRequest({ text: vi.fn().mockRejectedValue(new HTTPError({ statusCode: 404 })) }))

    const result = evvLookup({ numeroEvv: '01234' })
    return expect(result).resolves.toEqual({ siret: undefined, libelle: '', numero: '01234' })
  })

  test('remote server down', () => {
    expect.assertions(1)
    vi.mocked(evvClient.get).mockReturnValueOnce(asGotRequest({ text: vi.fn().mockRejectedValue(new TimeoutError({ message: 'Request timeout' })) }))

    const result = evvLookup({ numeroEvv: '01234' })
    return expect(result).rejects.toThrow("Impossible de communiquer avec l'API CVI.")
  })
})

describe('evvParcelles', () => {
  test('turns an EVV into a geometry-less featureCollection', async () => {
    expect.assertions(1)
    vi.mocked(evvClient.get).mockReturnValueOnce(asGotRequest({ text: vi.fn().mockResolvedValue(xmlParcellaire) }))

    const result = await evvParcellaire({ numeroEvv: '01234' })
    // https://cadastre.data.gouv.fr/map?style=ortho&parcelleId=95476000AI0520#17.03/49.06449/2.070498
    const expectation = {
      type: 'FeatureCollection',
      features: [
        {
          properties: {
            cadastre: ['95476000AI0520'],
            cultures: [
              {
                CPF: '01.21.12',
                variete: 'CHARDONNAY',
                surface: 0.0305
              }
            ]
          }
        },
        {
          properties: {
            cadastre: ['661980000A1020'],
            cultures: [
              {
                CPF: '01.21.12',
                variete: 'CARIGNAN',
                surface: 0.15
              },
              {
                CPF: '01.21.12',
                variete: 'CHARDONNAY',
                surface: 0.0262
              }
            ]
          }
        },
        {
          properties: {
            cadastre: ['012550000A1996'],
            cultures: []
          }
        }
      ]
    }

    return expect(result).toMatchObject(expectation)
  })
})

describe('test search with filter', () => {
  beforeEach(async () => {
    await loadRecordFixture(
      records.map(
        (r, index) =>
          (
            {
              ...r,
              numerobio: index + 1,
              annee_reference_controle: new Date().getFullYear()
            }
          )
      ),
      [1, 2, 3],
      1
    )
    get.mockReturnValueOnce({
      async json () {
        return {
          nbTotal: 11,
          operateurs: agencebioOperatorsApiResults.map((o) => ({ ...o, notifications: o.notifications.map((n) => ({ ...n, dateDemarrage: new Date(), updatedAt: new Date() })) }))
        }
      }
    })
  })

  test('no filter, records with no notifications or production filtered', async () => {
    const res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 5, filter: {} })
    expect(res.records).toHaveLength(5)
    expect(get).toHaveBeenCalledTimes(1)
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 7 })
  })

  test('no filter, records with no notifications filtered, page 2', async () => {
    const res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 2, limit: 5, filter: {} })
    expect(res.records).toHaveLength(2)
    expect(res.pagination).toEqual({ page: 2, page_max: 2, total: 7 })
  })

  test('records with no production not filter if text searc', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '12345678912345', page: 1, filter: {} })
    expect(res.records).toHaveLength(1)
    expect(get).not.toHaveBeenCalled()
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '12345678912345', page: 1, filter: {} })
    expect(res.records).toHaveLength(1)
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '246', page: 1, filter: {} })
    expect(res.records).toHaveLength(0)
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '462', page: 1, filter: {} })
    expect(res.records).toHaveLength(1)
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: 'Texte a chercher SARL', page: 1, filter: {} })
    expect(res.records).toHaveLength(1)
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: 'Texte a chercher', page: 1, filter: {} })
    expect(res.records).toHaveLength(1)
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: 'SARL', page: 1, filter: {}, limit: 5 })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 8 })
  })

  test('filter on notifications states', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['test'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['ENGAGEE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: 'SARL', page: 1, limit: 1, filter: { etatNotification: ['ENGAGEE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 3, total: 3 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['ENGAGEE', 'ENGAGEE FUTUR'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 4 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['SUSPENDUE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['ARRETEE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['RETIREE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  test('filter on etatCertification', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatCertification: 'ALL' } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatCertification: 'CERTIFIED', anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 8, filter: { etatCertification: 'NO_CERTIFIED', anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 6 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatCertification: 'CERTIFIED', anneeReferenceCertification: 1998 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  test('filter on statutParcellaire', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: [] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 4 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 4 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['PENDING_CERTIFICATION'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['PENDING_CERTIFICATION'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['PENDING_CERTIFICATION'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['OPERATOR_DRAFT'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['OPERATOR_DRAFT'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['OPERATOR_DRAFT'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['AUDITED'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['AUDITED'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['AUDITED'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 3 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 3 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE', 'CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE', 'CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE', 'CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  test('filter on departements', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: [] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['01'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 3 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: 'SARL', page: 1, filter: { departement: ['01'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 4 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['21'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['92'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['01', '21', '92'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 5 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['75'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  // TODO Verifier la cohérence de ce test
  test('filter on engagment', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { engagement: [] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { engagement: ['AB'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { engagement: ['ABCONV'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { engagement: ['MIXTE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { engagement: ['AB', 'ABCONV', 'MIXTE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  test('filter on pinned status', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { pinned: false } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { pinned: true } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })
  })

  test('sort result', async () => {
    const res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 10, filter: { sort: 'INVALIDE' } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    const resNomAsc = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 10, filter: { sort: 'nom-ASC' } })
    expect(resNomAsc.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    expect(res).toMatchObject(resNomAsc)
    expect(resNomAsc.records[0].nom).toEqual('Alfred')
    expect(resNomAsc.records[1].nom).toEqual('Benoit')
    expect(resNomAsc.records[2].nom).toEqual('Édouard')
    expect(resNomAsc.records[3].nom).toEqual('Françoise')
    expect(resNomAsc.records[4].nom).toEqual('Gregoire')
    expect(resNomAsc.records[5].nom).toEqual('- Joël')
    expect(resNomAsc.records[6].nom).toEqual('3Denise')

    const resNomDesc = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 10, filter: { sort: 'nom-DESC' } })
    expect(resNomAsc.records).toMatchObject(resNomDesc.records.reverse())

    const resDateAuditDesc = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 10, filter: { sort: 'date-audit-DESC' } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    const resDateAuditAsc = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 10, filter: { sort: 'date-audit-ASC' } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 7 })

    expect((resDateAuditDesc.records as WithMaxAuditDate[])[0].max_audit_date).toEqual('2023-09-07')
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[1].max_audit_date).toEqual('2022-05-01')
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[2].max_audit_date == null).toEqual(true)
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[2].nom).toEqual('Édouard')
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[3].nom).toEqual('Françoise')
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[4].nom).toEqual('Gregoire')
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[5].nom).toEqual('- Joël')
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[6].nom).toEqual('3Denise')
    expect((resDateAuditDesc.records as WithMaxAuditDate[])[6].max_audit_date == null).toEqual(true)

    expect((resDateAuditAsc.records as WithMaxAuditDate[])[6].max_audit_date).toEqual('2023-09-07')
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[5].max_audit_date).toEqual('2022-05-01')
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[4].max_audit_date == null).toEqual(true)
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[0].max_audit_date == null).toEqual(true)
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[0].nom).toEqual('Édouard')
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[1].nom).toEqual('Françoise')
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[2].nom).toEqual('Gregoire')
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[3].nom).toEqual('- Joël')
    expect((resDateAuditAsc.records as WithMaxAuditDate[])[4].nom).toEqual('3Denise')
  })
})

describe('pin, unpin, and consult', () => {
  test('successfully pin operator', async () => {
    await pinOperator(1, 1)
    await pinOperator(1, 2)
    await pinOperator(2, 2)
    await pinOperator(3, 2)
    await pinOperator(4, 2)
    await pinOperator(5, 2)
    await pinOperator(6, 2)
    await pinOperator(7, 2)

    expect(await getPinnedOperators(1)).toEqual([1])
    expect(await getPinnedOperators(2)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  test('successfully unpin operator', async () => {
    await pinOperator(1, 1)
    await pinOperator(1, 2)
    await pinOperator(2, 2)
    await pinOperator(3, 2)
    await pinOperator(4, 2)
    await pinOperator(5, 2)
    await pinOperator(6, 2)

    await unpinOperator(1, 1)
    await pinOperator(7, 2)
    await pinOperator(8, 2)
    await unpinOperator(5, 2)
    await unpinOperator(6, 2)

    expect(await getPinnedOperators(1)).toEqual([])
    expect(await getPinnedOperators(2)).toEqual([1, 2, 3, 4, 7, 8])
  })

  test('successfully consult operator', async () => {
    await consultOperator(1, 1)
    await consultOperator(1, 2)
    await consultOperator(2, 2)
    await consultOperator(3, 2)
    await consultOperator(4, 2)
    await consultOperator(5, 2)
    await consultOperator(6, 2)
    await consultOperator(7, 2)
    await consultOperator(8, 2)
    await consultOperator(9, 2)
    await consultOperator(10, 2)
    await consultOperator(11, 2)
    await consultOperator(12, 2)

    expect(await getConsultedOperators(1)).toEqual([1])
    expect(await getConsultedOperators(2)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('control and un control', () => {
  beforeEach(async () => {
    await loadRecordFixture(
      records.map(
        (r, index) =>
          (
            {
              ...r,
              numerobio: index + 1,
              annee_reference_controle: new Date().getFullYear()
            }
          )
      ),
      [1, 2, 3],
      1
    )
    get.mockReturnValueOnce({
      async json () {
        return {
          nbTotal: 11,
          operateurs: agencebioOperatorsApiResults.map((o) => ({ ...o, notifications: o.notifications.map((n) => ({ ...n, dateDemarrage: new Date(), updatedAt: new Date() })) }))
        }
      }
    })
  })

  test('successfully control and uncontrol operator', async () => {
    await markFeatureControlled(normalizedRecord.record_id, normalizedRecord.parcelles.features[0].id!, 1)

    let bddRecord = await getRecord(normalizedRecord.record_id, buildOcUser())

    expect(bddRecord!.parcelles.features[0].properties.controlee).toEqual(true)
    await markFeatureUncontrolled(normalizedRecord.record_id, normalizedRecord.parcelles.features[0].id!, 1)

    bddRecord = await getRecord(normalizedRecord.record_id, buildOcUser())
    expect(bddRecord!.parcelles.features[0].properties.controlee).toEqual(false)
  })
})
