import { loadParcellairesFixture } from '../../utils.js'
import records from '../../fixtures/providers/records.json' with { type: 'json' }
import { getGeometryEquals, verifyGeometry } from '../../../src/modules/geometry/geometry.service.js'
import { sql } from 'drizzle-orm'
import type { Polygon } from 'geojson'
import { db } from '../../../src/database/database.js'
import { parcellaires, parcelles } from '../../../src/database/schema/index.js'
import { areaHa, wgs84FromGeoJSON } from '../../../src/database/postgis.js'
import { findParcelBorder, findParcelBorderBetweenPoints } from '../../../src/modules/geometry/geometry.repository.js'

describe('verifyGeometry', () => {
  beforeEach(async () => {
    await loadParcellairesFixture()
  })

  test("Une geometry valide ne renvoie pas d'erreur", async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [6.762183076989215, 48.981124367260236],
          [6.764415065370428, 48.97673032941583],
          [6.765960288095883, 48.98095537296746],
          [6.762183076989215, 48.981124367260236]
        ]
      ]
    }
    expect(await verifyGeometry(geomGeoJSon, records[0]!.record_id)).toEqual({
      valid: true
    })
  })
  test('Une geometry inclus dans une autre renvoie une erreur', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [5.00742078063729, 44.71418584175069],
          [5.00619098801252, 44.71418584175069],
          [5.00619098801252, 44.71353436914191],
          [5.00742078063729, 44.71353436914191],
          [5.00742078063729, 44.71418584175069]
        ]
      ]
    }
    expect(await verifyGeometry(geomGeoJSon, records[0]!.record_id)).toEqual({
      valid: false
    })
  })

  test('Une geometry ne peux pas se chevaucher toute seule', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [5.0072, 44.72],
          [5.00619098801252, 44.71418584175069],
          [5.00619098801252, 44.71353436914191],
          [5.00742078063729, 44.71353436914191],
          [5.0072, 44.72]
        ]
      ]
    }

    expect(await verifyGeometry(geomGeoJSon, records[0]!.record_id, 1)).toEqual({
      valid: true
    })
  })
  test('Une geometry qui chevauche une autre renvoie une erreur et la correction', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [5.0072, 44.72],
          [5.00619098801252, 44.71418584175069],
          [5.00619098801252, 44.71353436914191],
          [5.00742078063729, 44.71353436914191],
          [5.0072, 44.72]
        ]
      ]
    }
    expect(await verifyGeometry(geomGeoJSon, records[0]!.record_id)).toEqual({
      valid: false,
      corrections: [
        {
          id: '1',
          existing_minus_intersection: {
            coordinates: [
              [
                [5.007420781, 44.714185842],
                [5.007420781, 44.713534369],
                [5.007398535, 44.714185842],
                [5.007420781, 44.714185842]
              ]
            ],
            type: 'Polygon'
          },
          new_minus_intersection: {
            coordinates: [
              [
                [5.0072, 44.72],
                [5.007398535, 44.714185842],
                [5.006190988, 44.714185842],
                [5.0072, 44.72]
              ]
            ],
            type: 'Polygon'
          },
          intersection: {
            type: 'Polygon',
            coordinates: [
              [
                [5.007398535, 44.714185842],
                [5.007420781, 44.713534369],
                [5.006190988, 44.713534369],
                [5.006190988, 44.714185842],
                [5.007398535, 44.714185842]
              ]
            ]
          }
        }
      ]
    })
  })

  test('Une geometry qui chevauche plusieurs autres renvoie une erreur et la correction', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [2.83, 44.3],
          [6.00619098801252, 44.71418584175069],
          [5.00619098801252, 44.71353436914191],
          [5.00742078063729, 44.71353436914191],
          [2.83, 44.3]
        ]
      ]
    }

    expect(await verifyGeometry(geomGeoJSon, records[0]!.record_id)).toEqual({
      valid: false,
      corrections: [
        {
          id: '1',
          new_minus_intersection: {
            type: 'Polygon',
            coordinates: [expect.anything()]
          },
          existing_minus_intersection: {
            type: 'Polygon',
            coordinates: [expect.anything()]
          },
          intersection: {
            type: 'Polygon',
            coordinates: [expect.anything()]
          }
        },
        {
          id: '2',
          new_minus_intersection: {
            type: 'Polygon',
            coordinates: [expect.anything()]
          },
          existing_minus_intersection: {
            type: 'Polygon',
            coordinates: [expect.anything()]
          },
          intersection: {
            type: 'Polygon',
            coordinates: [expect.anything()]
          }
        }
      ]
    })
  })
})

const square = (x: number, y: number, size = 0.001): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y]
    ]
  ]
})

const areaM2 = async (geometry: unknown): Promise<number> => {
  const result = await db.execute<{ area: number }>(
    sql`SELECT ST_Area(${wgs84FromGeoJSON(geometry)}::geography) AS area`
  )
  return Number(result.rows[0]!.area)
}

describe('getGeometryEquals', () => {
  const OLD = '00000000-0000-4000-8000-000000000001'
  const NEW = '00000000-0000-4000-8000-000000000002'
  const OTHER = '00000000-0000-4000-8000-000000000003'

  async function insertRecord(
    recordId: string,
    numeroBio: number,
    auditDate: string,
    items: Array<{ id: string; geometry: Polygon; numeroIlotPac?: number; numeroParcellesPac?: number; name?: string }>
  ): Promise<void> {
    await db.insert(parcellaires).values({
      recordId,
      numeroBio,
      auditDate,
      certificationEtat: 'AUDITED',
      versionNom: recordId,
      anneeReferenceControle: Number(auditDate.slice(0, 4))
    })
    for (const { geometry, ...item } of items) {
      const geom = wgs84FromGeoJSON(geometry)
      await db.insert(parcelles).values({ recordId, geometry: geom, surfaceHa: areaHa(geom), ...item })
    }
  }

  beforeEach(async () => {
    await db.delete(parcelles)
    await db.delete(parcellaires)
    await insertRecord(OLD, 1, '2023-06-01', [
      { id: 'p1', geometry: square(2, 47), numeroIlotPac: 1, numeroParcellesPac: 1 },
      { id: 'p2', geometry: square(2.01, 47), name: 'Supprimée' },
      { id: 'p3', geometry: square(2.02, 47) }
    ])
    await insertRecord(NEW, 1, '2024-06-01', [
      { id: 'q1', geometry: square(2.0002, 47), numeroIlotPac: 1, numeroParcellesPac: 2 },
      { id: 'q3', geometry: square(2.02, 47) },
      { id: 'q4', geometry: square(2.03, 47), name: 'Ajoutée' }
    ])
    await insertRecord(OTHER, 2, '2024-06-01', [])
  })

  const summarize = (result: Awaited<ReturnType<typeof getGeometryEquals>>) =>
    result[0]!.geojson.features.map(({ properties }) => properties as Record<string, unknown>)

  test('liste les parcelles modifiées, supprimées et ajoutées, sans les inchangées', async () => {
    const result = await getGeometryEquals({ old: OLD, new: NEW })

    expect(result[0]!.comparison_result).toBe('r1_old_r2_new')
    expect(summarize(result)).toEqual([
      { status: 'modified', new_id: 'q1', old_id: 'p1', label: 'Ilot 1 Parcelle 2', old_label: 'Ilot 1 Parcelle 1' },
      { status: 'deleted', new_id: null, old_id: 'p2', label: 'Supprimée', old_label: null },
      { status: 'added', new_id: 'q4', old_id: null, label: 'Ajoutée', old_label: null }
    ])
  })

  test("remet les parcellaires dans l'ordre chronologique", async () => {
    const result = await getGeometryEquals({ old: NEW, new: OLD })

    expect(result[0]!.comparison_result).toBe('r2_old_r1_new')
    expect(summarize(result).map(({ status, new_id }) => [status, new_id])).toEqual([
      ['modified', 'q1'],
      ['deleted', null],
      ['added', 'q4']
    ])
  })

  test('ignore les parcelles supprimées', async () => {
    await db
      .update(parcelles)
      .set({ deletedAt: sql`now()` })
      .where(sql`${parcelles.id} = 'q4'`)

    const result = await getGeometryEquals({ old: OLD, new: NEW })

    expect(summarize(result).map(({ status }) => status)).toEqual(['modified', 'deleted'])
  })

  test('ne compare pas les parcellaires de deux opérateurs différents', async () => {
    expect(await getGeometryEquals({ old: OLD, new: OTHER })).toEqual([])
  })

  test('ne compare pas un parcellaire inexistant', async () => {
    expect(await getGeometryEquals({ old: OLD, new: '00000000-0000-4000-8000-000000000009' })).toEqual([])
  })
})

describe('findParcelBorder', () => {
  test('sépare une bordure de la largeur demandée', async () => {
    const parcelle = square(2, 47)

    const result = await findParcelBorder(parcelle, 10)

    const [total, sansBordure, bordure] = await Promise.all([
      areaM2(parcelle),
      areaM2(result!.parcelleSansBordure),
      areaM2(result!.bordure)
    ])
    expect(sansBordure + bordure).toBeCloseTo(total, -1)
    expect(sansBordure).toBeLessThan(total)
    const cote = Math.sqrt(total)
    expect(bordure / (4 * cote)).toBeGreaterThan(5)
    expect(bordure / (4 * cote)).toBeLessThan(15)
  })
})

describe('findParcelBorderBetweenPoints', () => {
  const parcelle = square(2, 47)

  test("ne retire la bordure qu'entre les deux points", async () => {
    const complete = await findParcelBorder(parcelle, 10)
    const partielle = await findParcelBorderBetweenPoints(parcelle, 10, [2, 47], [2.001, 47], false)

    const [bordureComplete, bordurePartielle] = await Promise.all([
      areaM2(complete!.bordure),
      areaM2(partielle!.bordure)
    ])
    expect(bordurePartielle).toBeGreaterThan(0)
    expect(bordurePartielle).toBeLessThan(bordureComplete / 2)
  })

  test('inverse le côté de la bordure', async () => {
    const [directe, inversee] = await Promise.all([
      findParcelBorderBetweenPoints(parcelle, 10, [2, 47], [2.001, 47], false),
      findParcelBorderBetweenPoints(parcelle, 10, [2, 47], [2.001, 47], true)
    ])

    const [aireDirecte, aireInversee] = await Promise.all([areaM2(directe!.bordure), areaM2(inversee!.bordure)])
    expect(aireInversee).toBeGreaterThan(aireDirecte * 2)
  })
})
