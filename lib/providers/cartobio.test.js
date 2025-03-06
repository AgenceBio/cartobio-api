const { deleteSingleFeature, createOrUpdateOperatorRecord, updateAuditRecordState, updateFeature, searchControlBodyRecords, pinOperator, getPinnedOperators, unpinOperator, consultOperator } = require('./cartobio.js')
const { get, HTTPError, TimeoutError } = require('got')
const { NotFoundApiError } = require('../errors.js')
const [record] = require('./__fixtures__/records.json')
const records = require('./__fixtures__/records.json')
const recordToUpdate = require('./__fixtures__/records-to-update.json')
const parcelles = require('./__fixtures__/parcelles.json')
const otherParcelles = require('./__fixtures__/parcelles-aquacole-frontaliere.json')
const user = require('./__fixtures__/decoded-token-oc.json')
const agencebioOperator = require('./__fixtures__/agence-bio-operateur.json')
const agencebioOperatorsApiResults = require('./__fixtures__/agence-bio-operateur-for-search.json')
const { evvClient, evvLookup, evvParcellaire, parseAPIParcellaireStream } = require('./cartobio.js')
const { createReadStream, readFileSync } = require('fs')
const { join } = require('path')
const { normalizeRecord } = require('../outputs/record')
const db = require('../db')
const { loadRecordFixture } = require('../../test/utils')
const { EtatProduction, CertificationState } = require('../enums.js')
const { randomUUID } = require('crypto')
const { getConsultedOperators } = require('../outputs/operator.js')

const normalizedRecord = normalizeRecord({
  ...record,
  parcelles: parcelles
})

const xmlEvv = readFileSync(join(__dirname, './__fixtures__/cvi-evv.xml'), { encoding: 'utf8' })
const xmlParcellaire = readFileSync(join(__dirname, './__fixtures__/cvi-parcellaire.xml'), { encoding: 'utf8' })

beforeEach(() => jest.clearAllMocks())

describe('updateFeature', () => {
  afterEach(async () => {
    await db.query('DELETE FROM cartobio_operators where numerobio = \'' + record.numerobio + '\'')
  })

  test('successfully update feature', async () => {
    await loadRecordFixture()

    const featureId = 1
    const properties = {
      commune: '26108',
      conversion_niveau: 'AB',
      engagement_date: '2015-01-01',
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2',
      cultures: [
        {
          id: 1,
          commentaire: 'commentaire parcelle',
          CPF: '01.19.10.8',
          surface: 25,
          unit: '%',
          date_semis: '2022-03-24',
          variete: 'rouge bleue'
        }
      ]
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user, operator: {} }, { geometry: null, properties })
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
    const tmpRecords = record

    tmpRecords.oc_id = null
    await loadRecordFixture([tmpRecords])

    const featureId = 1
    const properties = {
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2'
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user, operator: {} }, { geometry: null, properties })
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
    const tmpRecords = record

    tmpRecords.oc_id = null
    await loadRecordFixture([tmpRecords])

    const featureId = 1
    const properties = {
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2'
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user: {}, operator: user }, { geometry: null, properties })

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
    const tmpRecords = record

    tmpRecords.oc_id = null
    await loadRecordFixture([tmpRecords])

    const tmpUser = { ...user }

    delete tmpUser.organismeCertificateur

    const featureId = 1
    const properties = {
      numero_ilot_pac: '1',
      numero_parcelle_pac: '2'
    }
    const result = await updateFeature({ featureId, record: normalizedRecord, user: tmpUser, operator: {} }, { geometry: null, properties })

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
  beforeEach(loadRecordFixture)

  const featureId = 1
  const reason = {
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
    await db.query('DELETE FROM cartobio_operators where numerobio = \'' + recordToUpdate.numerobio + '\'')
  })

  test('successfully update a record without data from previous record', async () => {
    const record = recordToUpdate

    // Data we don't want to copy
    await db.query('UPDATE cartobio_parcelles SET cultures = \'[{"id": "1", "CPF": "123", "variete": "VARIETE DIFFERENTE"}]\' WHERE id = \'' + parcelles[0].id + '\' AND record_id = \'' + record.record_id + '\'')

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
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
      { ...record, parcelles: featureCollection },
      { user, copyParcellesData: false, previousRecordId: record.record_id },
      db
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
    const record = { ...recordToUpdate }

    record.annee_reference_controle = ''

    // To avoid ON CONFLICT condition
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 12)
    await db.query('UPDATE cartobio_operators SET audit_date = \'' + pastDate.toISOString() + '\', created_at = \'' + pastDate.toISOString() + '\' WHERE record_id = \'' + record.record_id + '\'')

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
    }
    const result = await createOrUpdateOperatorRecord(
      { ...record, parcelles: featureCollection },
      { user, copyParcellesData: false, previousRecordId: record.record_id },
      db
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
    const record = { ...recordToUpdate }

    record.annee_reference_controle = ''
    record.audit_date = ''

    // To avoid ON CONFLICT condition
    const pastDate = new Date()
    pastDate.setDate(pastDate.getDate() - 12)
    await db.query('UPDATE cartobio_operators SET audit_date = \'' + pastDate.toISOString() + '\', created_at = \'' + pastDate.toISOString() + '\' WHERE record_id = \'' + record.record_id + '\'')

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
    }
    const result = await createOrUpdateOperatorRecord(
      { ...record, parcelles: featureCollection },
      { user, copyParcellesData: false, previousRecordId: record.record_id },
      db
    )

    expect(result).toMatchObject({
      version_name: record.version_name,
      annee_reference_controle: 2025,
      numerobio: record.numerobio,
      audit_date: null,
      certification_state: record.certification_state,
      metadata: record.metadata
    })
  })

  test('successfully create a record with data from previous record', async () => {
    const record = recordToUpdate

    // Data we want to copy
    await db.query('UPDATE cartobio_parcelles SET cultures = \'[{"id": "1", "CPF": "123", "variete": "VARIETE DIFFERENTE"}]\' WHERE id = \'' + parcelles[0].id + '\' AND record_id = \'' + record.record_id + '\'')

    // To avoid ON CONFLICT condition
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await db.query('UPDATE cartobio_operators SET audit_date = \'' + yesterday.toISOString() + '\', created_at = \'' + yesterday.toISOString() + '\' WHERE record_id = \'' + record.record_id + '\'')

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
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
      { ...record, record_id: randomUUID(), parcelles: featureCollection },
      { user, copyParcellesData: true, previousRecordId: record.record_id },
      db
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
    const record = recordToUpdate

    // To avoid ON CONFLICT condition
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await db.query('UPDATE cartobio_operators SET audit_date = \'' + yesterday.toISOString() + '\', created_at = \'' + yesterday.toISOString() + '\' WHERE record_id = \'' + record.record_id + '\'')

    // Data we don't want to copy
    await db.query('UPDATE cartobio_parcelles SET cultures = \'[{"id": "1", "CPF": "123", "variete": "VARIETE DIFFERENTE"}]\' WHERE id = \'' + parcelles[0].id + '\' AND record_id = \'' + record.record_id + '\'')

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
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
      { ...record, parcelles: featureCollection },
      { user, copyParcellesData: false, previousRecordId: record.record_id },
      db
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
    const record = recordToUpdate
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    await db.query('UPDATE cartobio_parcelles SET cultures = \'[{"id": "1", "CPF": "123", "variete": "VARIETE 1"}, {"id": "1", "CPF": "123", "variete": "VARIETE 2"}]\' WHERE id = \'' + parcelles[0].id + '\'')
    await db.query('UPDATE cartobio_operators SET audit_date = \'' + yesterday.toISOString() + '\', created_at = \'' + yesterday.toISOString() + '\' WHERE record_id = \'' + record.record_id + '\'')

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
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
      { ...record, parcelles: featureCollection },
      { user, copyParcellesData: true, previousRecordId: record.record_id },
      db
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
    const record = recordToUpdate
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    await db.query('UPDATE cartobio_parcelles SET cultures = \'[{"id": "1", "CPF": "123"}]\' WHERE id = \'' + parcelles[0].id + '\' AND record_id = \'' + record.record_id + '\'')
    await db.query('UPDATE cartobio_operators SET audit_date = \'' + yesterday.toISOString() + '\', created_at = \'' + yesterday.toISOString() + '\' WHERE record_id = \'' + record.record_id + '\'')

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
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
      { ...record, parcelles: featureCollection },
      { user, copyParcellesData: true, previousRecordId: record.record_id },
      db
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
    expect(result.parcelles[0].cultures[0].variete).toEqual('')
    expect(result.parcelles[1].cultures[0].variete).toEqual(parcelles[1].cultures[0].variete)
  })

  test('commune are found with update_communes trigger', async () => {
    const record = recordToUpdate

    const featureCollection = {
      type: 'FeatureCollection',
      features: []
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
      { ...record, parcelles: featureCollection },
      { user, copyParcellesData: false, previousRecordId: record.record_id },
      db
    )

    expect(result.parcelles).toHaveLength(6)
    expect(result.parcelles[0].commune).toEqual('26108')
    expect(result.parcelles[0].etranger).toEqual(false)
    expect(result.parcelles[1].commune).toEqual('26108')
    expect(result.parcelles[1].etranger).toEqual(false)
    expect(result.parcelles[2].commune).toEqual('26113')
    expect(result.parcelles[2].etranger).toEqual(false)
    expect(result.parcelles[3].commune).toEqual('26108')
    expect(result.parcelles[3].etranger).toEqual(false)
    expect(result.parcelles[4].commune).toEqual('59183')
    expect(result.parcelles[4].etranger).toEqual(false)
    expect(result.parcelles[5].commune).toBeNull()
    expect(result.parcelles[5].etranger).toEqual(true)
  })
})

describe('updateAuditRecordState', () => {
  afterEach(async () => {
    await db.query('DELETE FROM cartobio_operators where numerobio = \'' + recordToUpdate.numerobio + '\'')
  })

  test('successfully update version name', async () => {
    const record = recordToUpdate
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record },
      { version_name: 'Nouveau nom de version' }
    )
    expect(result).toMatchObject({
      version_name: 'Nouveau nom de version'
    })
  })

  test('successfully update certification state to PENDING_CERTIFICATION', async () => {
    const record = recordToUpdate
    record.certification_state = CertificationState.OPERATOR_DRAFT
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record },
      { certification_state: CertificationState.PENDING_CERTIFICATION }
    )
    expect(result).toMatchObject({
      certification_state: CertificationState.PENDING_CERTIFICATION
    })
  })

  test('successfully update certification state to AUDITED', async () => {
    const record = recordToUpdate
    record.audit_date = null
    record.certification_state = CertificationState.OPERATOR_DRAFT
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record },
      { certification_state: CertificationState.AUDITED }
    )
    expect(result.certification_state).toEqual(CertificationState.AUDITED)
    expect(result.audit_date).toEqual(new Date().toISOString().substring(0, 10))
  })

  test('successfully update certification state to AUDITED and set given audit_date', async () => {
    const record = recordToUpdate
    record.audit_date = null
    record.certification_state = CertificationState.OPERATOR_DRAFT
    record.oc_id = 1

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record },
      { certification_state: CertificationState.AUDITED, audit_date: '2024-12-01' }
    )
    expect(result.certification_state).toEqual(CertificationState.AUDITED)
    expect(result.audit_date).toEqual('2024-12-01')
  })

  test('successfully set user oc_id if record oc_id is null', async () => {
    const record = recordToUpdate
    record.oc_id = null

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user, record },
      { version_name: 'Attribution OC' }
    )
    expect(result).toMatchObject({
      version_name: 'Attribution OC',
      oc_id: user.organismeCertificateur.id
    })
  })

  test('successfully set operator oc_id if record oc_id is null', async () => {
    const record = recordToUpdate
    record.oc_id = null

    await loadRecordFixture([record])

    const result = await updateAuditRecordState(
      { user: {}, record, operator: { organismeCertificateur: { id: 10, nom: 'Test' } } },
      { version_name: 'Attribution OC' }
    )
    expect(result).toMatchObject({
      version_name: 'Attribution OC',
      oc_id: 10
    })
  })

  test('throw if not the correct OC', async () => {
    const record = recordToUpdate
    record.oc_id = 2

    await loadRecordFixture([record])

    await expect(updateAuditRecordState(
      { user, record },
      { version_name: 'Attribution OC' }
    )).rejects.toThrow()
  })
})

describe('evvLookup', () => {
  test('returns a known operator', () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockResolvedValue(xmlEvv) })

    const result = evvLookup({ numeroEvv: '01234' })

    return expect(result).resolves.toEqual({ siret: '999999999', libelle: 'test viti', numero: '01234' })
  })

  test('operator not found', () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockRejectedValue(new HTTPError({ statusCode: 404 })) })

    const result = evvLookup({ numeroEvv: '01234' })
    return expect(result).resolves.toEqual({ siret: undefined, libelle: '', numero: '01234' })
  })

  test('remote server down', () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockRejectedValue(new TimeoutError({ message: 'Request timeout' })) })

    const result = evvLookup({ numeroEvv: '01234' })
    return expect(result).rejects.toThrow("Impossible de communiquer avec l'API CVI.")
  })
})

describe('evvParcelles', () => {
  test('turns an EVV into a geometry-less featureCollection', async () => {
    expect.assertions(1)
    evvClient.get.mockReturnValueOnce({ text: jest.fn().mockResolvedValue(xmlParcellaire) })

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

describe('parseAPIParcellaireStream', () => {
  test('turns a file into a working GeoJSON', async () => {
    expect.assertions(20)

    // @ts-ignore
    const expectation = require('./__fixtures__/agence-bio-api-parcellaire_expectation.json')
    // @ts-ignore
    const anotherExpectation = require('./__fixtures__/agence-bio-api-parcellaire_another_expectation')
    const expectationWithoutIlot = require('./__fixtures__/agence-bio-api-parcellaire_expectation_without_numero_ilot.json')
    const expectationWithoutAssolement = require('./__fixtures__/agence-bio-api-parcellaire_expectation_without_assolement.json')
    const fixtureFile = createReadStream(join(__dirname, '__fixtures__', 'agence-bio-api-parcellaire.json'))
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }

    const generator = parseAPIParcellaireStream(fixtureFile, { organismeCertificateur })

    get.mockReturnValueOnce({
      async json () {
        return null
      }
    }).mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    }).mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    }).mockReturnValueOnce({
      async json () {
        return agencebioOperator
      }
    }).mockReturnValueOnce({
      async json () {
        const tmpAgencebioOperator = agencebioOperator

        tmpAgencebioOperator.notifications[0].activites = []
        return tmpAgencebioOperator
      }
    }).mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })

    const { value: result } = await generator.next()

    expect(result.warnings).toHaveLength(5)

    expect(result.warnings[0]).toMatchObject({
      message: 'Numéro bio inconnu du portail de notification',
      numeroBio: '99999'
    })
    expect(result.warnings[1]).toMatchObject({
      message: "Parcelle 1234 n'a pas de géométrie",
      numeroBio: '99999'
    })
    expect(result.warnings[2]).toMatchObject({
      message: "Parcelle 1235 n'a pas de géométrie",
      numeroBio: '99999'
    })
    expect(result.warnings[3]).toMatchObject({
      message: "Parcelle 45758 n'a pas de géométrie",
      numeroBio: '99999'
    })

    expect(result.warnings[4]).toMatchObject({
      message: 'Parcelle 45736 a une géométrie invalide',
      numeroBio: '99999'
    })

    expect(JSON.parse(JSON.stringify(result))).toMatchObject(expectation)

    await expect(generator.next()).resolves.not.toThrow()

    await expect(generator.next()).resolves.toMatchObject({
      value: {
        numeroBio: '101903',
        error: new Error('champ geom incorrect : Expected \',\' or \']\' after array element in JSON at position 32635')
      }
    })

    const { value: someResult } = await generator.next()

    expect(someResult.warnings).toHaveLength(6)
    expect(someResult.warnings[5]).toMatchObject({
      message: 'Parcelle 45738 en dehors des régions autorisées',
      numeroBio: '123456'
    })
    const { value: anotherResult } = await generator.next()

    expect(anotherResult.warnings).toHaveLength(7)

    expect(anotherResult.warnings[6]).toMatchObject({
      message: 'Numéro bio sans notification liée à une activité de production',
      numeroBio: '654321'
    })
    const parsedResult = JSON.parse(JSON.stringify(anotherResult))
    expect(parsedResult).toMatchObject(anotherExpectation)

    const { value: resultWithoutIlot } = await generator.next()

    const parsedResultWithoutIlot = JSON.parse(JSON.stringify(resultWithoutIlot))
    expect(parsedResultWithoutIlot).toMatchObject(expectationWithoutIlot)
    expect('anneeReferenceControle' in parsedResult.record.metadata).toEqual(false)
    expect('anneeAssolement' in parsedResult.record.metadata).toEqual(true)

    const { value: resultWithoutAssolement } = await generator.next()

    const parsedResultWithoutAssolement = JSON.parse(JSON.stringify(resultWithoutAssolement))
    expect(parsedResultWithoutAssolement).toMatchObject(expectationWithoutAssolement)
    expect('anneeReferenceControle' in parsedResult.record.metadata).toEqual(false)
    expect('anneeAssolement' in parsedResult.record.metadata).toEqual(true)
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
          operateurs: agencebioOperatorsApiResults.map((o) => ({ ...o, notifications: o.notifications.map((n) => ({ ...n, dateDemarrage: new Date() })) }))
        }
      }
    })
  })

  test('no filter, records with no notifications or production filtered', async () => {
    const res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: {} })
    expect(res.records).toHaveLength(7)
    expect(get).toHaveBeenCalledTimes(1)
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })
  })

  test('no filter, records with no notifications filtered, page 2', async () => {
    const res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 2, filter: {} })
    expect(res.records).toHaveLength(3)
    expect(res.pagination).toEqual({ page: 2, page_max: 2, total: 10 })
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
    expect(res.pagination).toEqual({ page: 1, page_max: 3, total: 11 })
  })

  test('filter on notifications states', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['test'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['ENGAGEE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: 'SARL', page: 1, limit: 1, filter: { etatNotification: ['ENGAGEE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 3, total: 3 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['ENGAGEE', 'ENGAGEE FUTUR'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 3 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['SUSPENDUE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['BROUILLON'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['ARRETEE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatNotification: ['RETIREE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })
  })

  test('filter on etatCertification', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatCertification: 'ALL' } })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatCertification: 'CERTIFIED', anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, limit: 8, filter: { etatCertification: 'NO_CERTIFIED', anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 8 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { etatCertification: 'CERTIFIED', anneeReferenceCertification: 1998 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  test('filter on statutParcellaire', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: [] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 6 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 6 })
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
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 4 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 4 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE', 'CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE', 'CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: new Date().getFullYear() } })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })
    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { statutParcellaire: ['NONE', 'CERTIFIED', 'AUDITED', 'PENDING_CERTIFICATION', 'OPERATOR_DRAFT'], anneeReferenceCertification: 2001 } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  test('filter on departements', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: [] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['01'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 5 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: 'SARL', page: 1, filter: { departement: ['01'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 6 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['21'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 2 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['92'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 1 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['01', '21', '92'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 8 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { departement: ['75'] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 0 })
  })

  // TODO Verifier la cohérence de ce test
  test('filter on engagment', async () => {
    let res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { engagement: [] } })
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })

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
    expect(res.pagination).toEqual({ page: 1, page_max: 2, total: 10 })

    res = await searchControlBodyRecords({ ocId: 1, userId: 1, input: '', page: 1, filter: { pinned: true } })
    expect(res.pagination).toEqual({ page: 1, page_max: 1, total: 3 })
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
