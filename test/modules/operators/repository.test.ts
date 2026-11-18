import { sql } from 'drizzle-orm'
import { db } from '../../../src/database/database.js'
import { importPac, parcellaires } from '../../../src/database/schema/index.js'
import {
  findRecordData,
  findDashboardStates,
  findImportPac,
  updateImportPacImported
} from '../../../src/modules/operators/operators.repository.js'
import { buildOperator } from '../../factories.js'

async function insertParcellaire(numeroBio: number, certificationEtat: string, anneeReferenceControle = 2025) {
  await db.insert(parcellaires).values({
    numeroBio,
    certificationEtat: certificationEtat as 'CERTIFIED',
    anneeReferenceControle,
    versionNom: `${numeroBio}-${certificationEtat}`
  })
}

describe('findDashboardStates', () => {
  beforeEach(async () => {
    await db.delete(parcellaires)
    await insertParcellaire(1, 'CERTIFIED')
    await insertParcellaire(1, 'AUDITED')
    await insertParcellaire(2, 'PENDING_CERTIFICATION')
    await insertParcellaire(3, 'OPERATOR_DRAFT')
    await insertParcellaire(4, 'CERTIFIED', 2024)
    await insertParcellaire(5, 'CERTIFIED')
    await db
      .update(parcellaires)
      .set({ deletedAt: sql`now()` })
      .where(sql`${parcellaires.numeroBio} = 5`)
  })

  test("regroupe les opérateurs certifiés et en attente pour l'année", async () => {
    const rows = await findDashboardStates(['1', '2', '3', '4', '5'], 2025)

    expect(rows.find(({ certifie }) => certifie)?.numerobios).toEqual(['1'])
    expect(rows.find(({ certifie }) => !certifie)?.numerobios.sort()).toEqual(['1', '2'])
  })

  test('ignore les numéros bio non entiers', async () => {
    expect(await findDashboardStates(['abc'], 2025)).toEqual([])
  })
})

describe('findImportPac / updateImportPacImported', () => {
  beforeEach(async () => {
    await db.delete(importPac)
    await db.insert(importPac).values({ numeroBio: '99999', pacage: '012345678', nbParcelles: 3, size: 12.5 })
  })

  test("retrouve l'import PAC d'un opérateur", async () => {
    expect(await findImportPac(99999)).toMatchObject({
      pacage: '012345678',
      nb_parcelles: 3,
      size: 12.5,
      imported: false
    })
    expect(await findImportPac(11111)).toBeNull()
  })

  test("masque la notification d'import", async () => {
    await updateImportPacImported(99999)

    expect(await findImportPac('99999')).toMatchObject({ imported: true })
  })
})

describe('findRecordData', () => {
  test('ne cherche pas de parcellaire pour un numéro bio non entier', async () => {
    const operator = buildOperator({ numeroBio: 'abc' })

    expect(await findRecordData(operator)).toEqual({ ...operator, metadata: {} })
  })
})
