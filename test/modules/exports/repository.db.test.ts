import { eq, sql } from 'drizzle-orm'
import { AttestationsProductionsStatus, AttestationsProductionsType } from '@agencebio/cartobio-types'
import { db } from '../../../src/database/database.js'
import { attestationsProduction, parcellaires, parcelles } from '../../../src/database/schema/index.js'
import {
  deleteAttestationsProductions,
  failInterruptedAttestationsProductions,
  findExportRows,
  findPdfParcelles,
  findPdfRecord,
  findValidAttestationProduction,
  updateAttestationsProductions
} from '../../../src/modules/exports/exports.repository.js'
import { loadRecordFixture } from '../../utils.js'

const RECORD = '054f0d70-c3da-448f-823e-81fcf7c2bf6e'
const CERTIFIED = '054f0d70-c3da-448f-823e-81fcf7c11112'
const { COMPLET, PACCOMPLET } = AttestationsProductionsType
const { STARTED, GENERATED } = AttestationsProductionsStatus

beforeEach(async () => {
  await db.delete(attestationsProduction)
  await loadRecordFixture()
  await db.update(parcellaires).set({ updatedAt: sql`now() - interval '1 minute'` })
})

describe('attestations de production', () => {
  test('retrouve une attestation générée après la dernière modification du parcellaire', async () => {
    await updateAttestationsProductions(RECORD, STARTED, COMPLET)
    expect(await findValidAttestationProduction(RECORD, COMPLET)).toBeNull()

    await updateAttestationsProductions(RECORD, GENERATED, COMPLET, '/tmp/a.pdf')

    expect(await findValidAttestationProduction(RECORD, COMPLET)).toEqual({ path: '/tmp/a.pdf' })
    expect(await findValidAttestationProduction(RECORD, PACCOMPLET)).toBeNull()
    expect(await db.select().from(attestationsProduction)).toHaveLength(1)
  })

  test('ignore une attestation antérieure à une modification du parcellaire', async () => {
    await updateAttestationsProductions(RECORD, GENERATED, COMPLET, '/tmp/a.pdf')
    await db
      .update(parcellaires)
      .set({ updatedAt: sql`now() + interval '1 minute'` })
      .where(eq(parcellaires.recordId, RECORD))

    expect(await findValidAttestationProduction(RECORD, COMPLET)).toBeNull()
  })

  test('marque en erreur les générations interrompues depuis plus d’une heure', async () => {
    await updateAttestationsProductions(RECORD, STARTED, COMPLET)
    await updateAttestationsProductions(RECORD, STARTED, PACCOMPLET)
    await updateAttestationsProductions(CERTIFIED, GENERATED, COMPLET, '/tmp/b.pdf')
    await db
      .update(attestationsProduction)
      .set({ updatedAt: sql`now() - interval '2 hours'` })
      .where(eq(attestationsProduction.type, COMPLET))

    expect(await failInterruptedAttestationsProductions()).toBe(1)

    const rows = await db
      .select({
        recordId: attestationsProduction.recordId,
        type: attestationsProduction.type,
        status: attestationsProduction.status
      })
      .from(attestationsProduction)
    expect(rows).toEqual(
      expect.arrayContaining([
        { recordId: RECORD, type: COMPLET, status: 'error' },
        { recordId: RECORD, type: PACCOMPLET, status: STARTED },
        { recordId: CERTIFIED, type: COMPLET, status: GENERATED }
      ])
    )
  })

  test("supprime les attestations d'un parcellaire uniquement", async () => {
    await updateAttestationsProductions(RECORD, GENERATED, COMPLET, '/tmp/a.pdf')
    await updateAttestationsProductions(CERTIFIED, GENERATED, COMPLET, '/tmp/b.pdf')

    await deleteAttestationsProductions(RECORD)

    expect((await db.select().from(attestationsProduction)).map(({ recordId }) => recordId)).toEqual([CERTIFIED])
  })
})

describe('findPdfRecord', () => {
  test("retourne les informations du parcellaire avec le libellé de l'OC", async () => {
    expect(await findPdfRecord(CERTIFIED)).toMatchObject({
      audit_date: '2022-05-01',
      certification_date_debut: '2022-01-01',
      oc_label: 'CartobiOC'
    })
  })

  test('retourne null pour un parcellaire inconnu', async () => {
    expect(await findPdfRecord('aaaaaaaa-c3da-448f-823e-81fcf7c2bf6e')).toBeNull()
  })
})

describe('findExportRows', () => {
  test('agrège les surfaces des parcelles actives par niveau de conversion', async () => {
    await db
      .update(parcelles)
      .set({ deletedAt: sql`now()` })
      .where(sql`${parcelles.recordId} = ${CERTIFIED} AND ${parcelles.id} = '3'`)

    const rows = await findExportRows(999, [99999])
    const row = rows.find(({ record_id }) => record_id === CERTIFIED)!

    expect(rows.every(({ numerobio }) => numerobio === 99999)).toBe(true)
    expect(row).toMatchObject({ nombre_parcelles: 2, certification_state: 'CERTIFIED', audit_date: '2022-05-01' })
    expect(row.surface_ab_ha).toBeGreaterThan(0)
    expect(row.superficie_totale_ha).toBeGreaterThan(row.surface_ab_ha)
    expect([row.surface_c1_ha, row.surface_c2_ha, row.surface_c3_ha, row.surface_conventionnel_ha]).toEqual([
      0, 0, 0, 0
    ])
  })

  test("ne retourne que les parcellaires de l'OC demandé, non supprimés", async () => {
    await db
      .update(parcellaires)
      .set({ deletedAt: sql`now()` })
      .where(eq(parcellaires.recordId, CERTIFIED))

    expect((await findExportRows(999, [99999])).map(({ record_id }) => record_id)).not.toContain(CERTIFIED)
    expect(await findExportRows(1, [99999])).toEqual([])
    expect(await findExportRows(999, [])).toEqual([])
  })
})

describe('findPdfParcelles', () => {
  test('retourne toutes les parcelles avec leurs cultures', async () => {
    const result = await findPdfParcelles(CERTIFIED, false)

    expect(result.map(({ id }) => id).sort()).toEqual(['1', '2', '3'])
    const parcelle2 = result.find(({ id }) => id === '2')!
    expect(parcelle2.cultures.map(({ CPF }) => CPF).sort()).toEqual(['01.13.42', '01.23.11'])
    expect(parcelle2.minx).toBeLessThan(parcelle2.maxx)
    expect(JSON.parse(parcelle2.geojson).type).toBe('Polygon')
  })

  test('ne retourne en mode PAC que les parcelles PAC ou en attente PAC', async () => {
    await db
      .update(parcelles)
      .set({ attentePac: true })
      .where(sql`${parcelles.recordId} = ${CERTIFIED} AND ${parcelles.id} = '3'`)

    const result = await findPdfParcelles(CERTIFIED, true)

    expect(result.map(({ id }) => id).sort()).toEqual(['1', '3'])
    expect(result.find(({ id }) => id === '1')).toMatchObject({ nbilot: '1', nbp: '2' })
  })
})
