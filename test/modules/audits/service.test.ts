import { CertificationState, toIsoDate } from '@agencebio/cartobio-types'
import type { FeatureInput } from '@agencebio/cartobio-types'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { db } from '../../../src/database/database.js'
import * as repository from '../../../src/modules/audits/audits.repository.js'
import * as parcellairesRepository from '../../../src/shared/parcellaires/parcellaires.repository.js'
import * as cartobio from '../../../src/shared/parcellaires/parcellaires.service.js'
import { deleteRecordAttestations } from '../../../src/modules/exports/exports.service.js'
import {
  createFeaturesFromOther,
  deleteRecord,
  deleteSingleFeature,
  updateAuditRecordState,
  updateFeature
} from '../../../src/modules/audits/audits.service.js'
import type { DBOperatorRecord } from '../../../src/shared/parcellaires/parcellaires.types.js'
import { buildFeature, buildNormalizedRecord, buildOcUser, buildOperator } from '../../factories.js'

vi.mock('../../../src/modules/audits/audits.repository.js')
vi.mock('../../../src/shared/parcellaires/parcellaires.repository.js')
vi.mock('../../../src/shared/parcellaires/parcellaires.service.js')
vi.mock('../../../src/modules/exports/exports.service.js')

const mockedRepo = vi.mocked(repository)
const mockedParcellairesRepo = vi.mocked(parcellairesRepository)
const dbRow = { record_id: 'r1' } as unknown as DBOperatorRecord
const tx = {} as NodePgDatabase

beforeEach(() => {
  vi.clearAllMocks()
  mockedRepo.updateAuditRecord.mockResolvedValue([dbRow])
  mockedRepo.setOperatorUpdatedAt.mockResolvedValue([dbRow])
  vi.mocked(cartobio.joinRecordParcelles).mockImplementation(async (record) => ({
    ...record,
    parcelles: []
  }))
  vi.mocked(cartobio.withHistoryUsers).mockImplementation(async (record) => record)
  vi.mocked(cartobio.notifyCertificationComplete).mockResolvedValue(undefined)
  vi.spyOn(db, 'transaction').mockImplementation((async (cb: (t: NodePgDatabase) => unknown) =>
    cb(tx)) as unknown as typeof db.transaction)
})

describe('updateAuditRecordState', () => {
  test.each([
    ['début', { certification_date_fin: toIsoDate('2025-12-31') }],
    ['fin', { certification_date_debut: toIsoDate('2025-01-01') }],
    ['début et fin', {}]
  ])('refuse la certification sans date de %s', async (_, dates) => {
    const record = buildNormalizedRecord()

    await expect(
      updateAuditRecordState(
        { user: buildOcUser(), record },
        { certification_state: CertificationState.CERTIFIED, ...dates }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Les dates de certification sont manquantes.'
    })
    expect(mockedRepo.updateAuditRecord).not.toHaveBeenCalled()
  })

  test('certifie avec les dates déjà présentes sur le parcellaire et notifie une seule fois', async () => {
    const record = buildNormalizedRecord({
      certification_date_debut: toIsoDate('2025-01-01'),
      certification_date_fin: toIsoDate('2025-12-31'),
      certification_state: CertificationState.AUDITED
    })
    mockedParcellairesRepo.findMixite.mockResolvedValue('AB')

    await updateAuditRecordState({ user: buildOcUser(), record }, { certification_state: CertificationState.CERTIFIED })

    expect(mockedParcellairesRepo.findMixite).toHaveBeenCalledWith(db, record.record_id)
    expect(mockedRepo.updateAuditRecord.mock.calls[0]![2]).toMatchObject({ mixite: 'AB' })
    expect(cartobio.notifyCertificationComplete).toHaveBeenCalledWith(record)
  })

  test('ne renotifie pas un parcellaire déjà certifié', async () => {
    const record = buildNormalizedRecord({
      certification_date_debut: toIsoDate('2025-01-01'),
      certification_date_fin: toIsoDate('2025-12-31'),
      certification_state: CertificationState.CERTIFIED
    })

    await updateAuditRecordState(
      { user: buildOcUser(), record },
      { certification_state: CertificationState.CERTIFIED, mixite: 'MIXTE' }
    )

    expect(mockedParcellairesRepo.findMixite).not.toHaveBeenCalled()
    expect(cartobio.notifyCertificationComplete).not.toHaveBeenCalled()
  })

  test("renseigne l'OC de l'utilisateur sur un parcellaire qui n'en a pas", async () => {
    const record = buildNormalizedRecord({ oc_id: null })

    await updateAuditRecordState({ user: buildOcUser(), record }, { audit_notes: 'note' })

    expect(mockedRepo.updateAuditRecord.mock.calls[0]![2]).toMatchObject({
      oc_id: 1,
      oc_label: "CartoBi'OC"
    })
    expect(mockedRepo.updateAuditRecord.mock.calls[0]![3]).toBeNull()
  })

  test("se rabat sur l'OC de l'opérateur et ne remplace pas un OC existant", async () => {
    const user = buildOcUser({ organismeCertificateur: undefined })
    const operator = buildOperator({ organismeCertificateur: { id: 7, nom: 'OC opérateur' } })

    await updateAuditRecordState({ user, record: buildNormalizedRecord({ oc_id: null }), operator }, {})
    expect(mockedRepo.updateAuditRecord.mock.calls[0]![2]).toMatchObject({
      oc_id: 7,
      oc_label: 'OC opérateur'
    })

    await updateAuditRecordState({ user, record: buildNormalizedRecord({ oc_id: 3 }), operator }, {})
    expect(mockedRepo.updateAuditRecord.mock.calls[1]![2]).not.toHaveProperty('oc_id')
  })

  test("convertit un doublon de date d'audit en erreur 400", async () => {
    mockedRepo.updateAuditRecord.mockRejectedValue(new Error('duplicate', { cause: { code: '23505' } }))

    await expect(
      updateAuditRecordState({ user: buildOcUser(), record: buildNormalizedRecord() }, {})
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Un parcellaire ne peut pas avoir deux versions avec la même date d'audit."
    })
  })

  test('propage les autres erreurs de la base', async () => {
    const error = new Error('DB down')
    mockedRepo.updateAuditRecord.mockRejectedValue(error)

    await expect(updateAuditRecordState({ user: buildOcUser(), record: buildNormalizedRecord() }, {})).rejects.toBe(
      error
    )
  })
})

describe('deleteRecord', () => {
  test("n'échoue pas si la suppression des attestations échoue", async () => {
    const record = buildNormalizedRecord()
    vi.mocked(deleteRecordAttestations).mockRejectedValue(new Error('S3 down'))

    await expect(deleteRecord(record)).resolves.toBeUndefined()
    expect(mockedRepo.softDeleteRecord).toHaveBeenCalledWith(record.record_id)
  })
})

describe('parcelle introuvable', () => {
  const record = buildNormalizedRecord({
    parcelles: { type: 'FeatureCollection', features: [buildFeature()] }
  })
  const input = buildFeature() as unknown as FeatureInput

  test('updateFeature retourne une 404', async () => {
    await expect(updateFeature({ featureId: 'inconnue', user: buildOcUser(), record }, input)).rejects.toMatchObject({
      statusCode: 404
    })
    expect(db.transaction).not.toHaveBeenCalled()
  })

  test('deleteSingleFeature retourne une 404', async () => {
    await expect(
      deleteSingleFeature({ featureId: 'inconnue', user: buildOcUser(), record }, { reason: { code: 'other' } })
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe('createFeaturesFromOther', () => {
  test('remplace les parcelles sources par de nouvelles parcelles aux identifiants générés', async () => {
    const record = buildNormalizedRecord({ certification_state: CertificationState.CERTIFIED })
    const input = [buildFeature({ id: 'fourni' }) as unknown as FeatureInput]

    await createFeaturesFromOther(buildOcUser(), record, null, input, ['a', 'b'])

    expect(mockedRepo.softDeleteFeatures).toHaveBeenCalledWith(tx, record.record_id, ['a', 'b'])
    const [, , features, from] = mockedRepo.addFeaturesFromOther.mock.calls[0]!
    expect(from).toEqual(['a', 'b'])
    expect(features[0]!.id).not.toBe('fourni')
    expect(mockedRepo.setOperatorUpdatedAt).toHaveBeenCalledWith(
      tx,
      record.record_id,
      expect.objectContaining({ description: 'Parcelles ajoutées' }),
      1,
      "CartoBi'OC",
      undefined
    )
    expect(mockedParcellairesRepo.updateMixite).toHaveBeenCalledWith(tx, record.record_id)
  })

  test('exige le niveau de conversion sur un parcellaire certifié', async () => {
    const record = buildNormalizedRecord({ certification_state: CertificationState.CERTIFIED })
    const input = [buildFeature({ properties: { conversion_niveau: undefined } }) as unknown as FeatureInput]

    await expect(createFeaturesFromOther(buildOcUser(), record, null, input, ['a'])).rejects.toMatchObject({
      statusCode: 400
    })
    expect(db.transaction).not.toHaveBeenCalled()
  })
})
