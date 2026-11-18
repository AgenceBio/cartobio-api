import { Readable } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import gdal from 'gdal-async'
import type { MultipartFile } from '@fastify/multipart'
import type { Polygon } from 'geojson'
import { parseAnyGeographicalArchive, unzipGeographicalContent } from '../../src/shared/geo/gdal.js'

const upload = (content: Buffer | string): Promise<MultipartFile> =>
  Promise.resolve({ file: Readable.from([Buffer.from(content)]) } as unknown as MultipartFile)

const ring = (x: number, y: number, size = 0.001, z?: number) =>
  [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y]
  ].map((point) => (z === undefined ? point : [...point, z]))

const geojson = (features: object[]) => JSON.stringify({ type: 'FeatureCollection', features })
const feature = (geometry: object | null, properties: object = {}) => ({ type: 'Feature', geometry, properties })

function zip(files: Record<string, Buffer | string>): Buffer {
  const archive = new AdmZip()
  for (const [name, content] of Object.entries(files)) archive.addFile(name, Buffer.from(content))
  return archive.toBuffer()
}

describe('parseAnyGeographicalArchive', () => {
  test('refuse une requête sans fichier', async () => {
    await expect(parseAnyGeographicalArchive(Promise.resolve(undefined))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Aucun fichier transmis.'
    })
  })

  test('lit un GeoJSON et découpe les multipolygones en parcelles distinctes sans altitude', async () => {
    const result = await parseAnyGeographicalArchive(
      upload(
        geojson([
          feature({ type: 'Polygon', coordinates: [ring(2, 47)] }, { id: 'p1', NOM: 'Champ', NUMERO_I: '3' }),
          feature(
            { type: 'MultiPolygon', coordinates: [[ring(2.01, 47, 0.001, 120)], [ring(2.02, 47, 0.001, 130)]] },
            { NOM: 'Double' }
          )
        ])
      )
    )

    expect(result.features).toHaveLength(3)
    expect(result.features[0]).toMatchObject({ id: 'p1', properties: { id: 'p1', NOM: 'Champ', NUMERO_I: 3 } })
    const [, first, second] = result.features
    expect(first!.properties).toMatchObject({ NOM: 'Double' })
    expect(first!.id).not.toBe(second!.id)
    expect((first!.geometry as Polygon).coordinates[0]![0]).toEqual([2.01, 47])
  })

  test('ignore les géométries qui ne sont pas des polygones', async () => {
    const result = await parseAnyGeographicalArchive(
      upload(
        geojson([
          feature({
            type: 'LineString',
            coordinates: [
              [2, 47],
              [2.1, 47.1]
            ]
          }),
          feature({ type: 'Polygon', coordinates: [ring(2, 47)] })
        ])
      )
    )

    expect(result.features.map(({ geometry }) => geometry.type)).toEqual(['Polygon'])
  })

  test('refuse une parcelle sans géométrie', async () => {
    await expect(
      parseAnyGeographicalArchive(
        upload(geojson([feature({ type: 'Polygon', coordinates: [ring(2, 47)] }), feature(null)]))
      )
    ).rejects.toMatchObject({ statusCode: 400, message: 'Le fichier contient une parcelle sans géométrie.' })
  })

  test('refuse des propriétés invalides', async () => {
    await expect(
      parseAnyGeographicalArchive(
        upload(geojson([feature({ type: 'Polygon', coordinates: [ring(2, 47)] }, { COMMUNE: '123' })]))
      )
    ).rejects.toMatchObject({ statusCode: 400, message: 'Le fichier contient des propriétés invalides' })
  })

  test("refuse un XML qui n'est pas du KML", async () => {
    await expect(parseAnyGeographicalArchive(upload('<?xml version="1.0"?><root></root>'))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Format de fichier non-reconnu.'
    })
  })

  test('refuse un fichier illisible', async () => {
    await expect(parseAnyGeographicalArchive(upload('ceci n’est pas un fichier géographique'))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Format de fichier non-reconnu.'
    })
  })

  test('refuse une archive sans fichier géographique', async () => {
    await expect(parseAnyGeographicalArchive(upload(zip({ 'lisezmoi.txt': 'rien' })))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Format de fichier non-reconnu.'
    })
  })

  describe('shapefile sans projection', () => {
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'cartobio-shp-'))
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    function shapefile(polygons: number[][][][]): Buffer {
      const path = join(dir, 'parcelles.shp')
      const dataset = gdal.open(path, 'w', 'ESRI Shapefile')
      const layer = dataset.layers.create('parcelles', null, gdal.wkbPolygon)
      for (const coordinates of polygons) {
        const f = new gdal.Feature(layer)
        f.setGeometry(gdal.Geometry.fromGeoJson({ type: 'Polygon', coordinates }))
        layer.features.add(f)
      }
      dataset.close()
      return zip(
        Object.fromEntries(
          ['shp', 'shx', 'dbf'].map((ext) => [`parcelles.${ext}`, readFileSync(join(dir, `parcelles.${ext}`))])
        )
      )
    }

    test('devine la projection Lambert 93 et reprojette en WGS84', async () => {
      const lambert93 = [
        [
          [652000, 6862000],
          [652100, 6862000],
          [652100, 6862100],
          [652000, 6862100],
          [652000, 6862000]
        ]
      ]

      const result = await parseAnyGeographicalArchive(upload(shapefile([lambert93])))

      const [x, y] = (result.features[0]!.geometry as Polygon).coordinates[0]![0]!
      expect(x).toBeCloseTo(2.35, 1)
      expect(y).toBeCloseTo(48.86, 1)
    })

    test('refuse un shapefile vide dont la projection ne peut être devinée', async () => {
      await expect(parseAnyGeographicalArchive(upload(shapefile([])))).rejects.toMatchObject({
        statusCode: 400,
        message: "Impossible de déterminer la projection : la première parcelle n'a pas de géométrie."
      })
    })
  })
})

describe('unzipGeographicalContent', () => {
  test('refuse une archive corrompue', async () => {
    const corrupted = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(30)])

    await expect(unzipGeographicalContent(corrupted)).rejects.toMatchObject({
      statusCode: 400,
      message: "L'archive ZIP ne peut pas être lue. Provient-elle d'une source de donnée authentique ?"
    })
  })

  test('ne garde que les fichiers géographiques principaux, hors fichiers cachés', async () => {
    const { path, files, cleanup } = await unzipGeographicalContent(
      zip({
        'a.shp': 'x',
        'a.shx': 'x',
        'a.dbf': 'x',
        'b.geojson': '{}',
        'dossier/.cache.kml': 'x',
        'lisezmoi.txt': 'x'
      })
    )

    expect(files.map((file) => String(file).replace(`${path}/`, '')).sort()).toEqual(['a.shp', 'b.geojson'])
    await cleanup()
  })
})
