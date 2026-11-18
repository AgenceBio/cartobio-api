import { createWriteStream } from 'fs'
import { promisify } from 'node:util'
import { createGunzip } from 'node:zlib'
import stream from 'node:stream'
import { join } from 'path'
import { DATA_DIR } from '../src/shared/paths.js'
import gotModule from 'got'
const got = gotModule.default
import JSONStream from 'jsonstream-next'
import fs from 'fs'
import union from '@turf/union'
import * as turf from '@turf/helpers'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'

const pipeline = promisify(stream.pipeline)

const generatedDataDirectory = join(DATA_DIR, 'generated')
const referenceDataDirectory = join(DATA_DIR, 'reference')
async function fetchCommunesBoundaries(): Promise<void> {
  // Skip if file already exists
  const outFile = join(generatedDataDirectory, 'communes.json')
  if (fs.existsSync(outFile)) {
    console.log('Commune boundaries file already exists, skipping')
    return
  }

  const FILENAME = 'communes-50m.geojson.gz'
  const SOURCE = 'http://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

  return pipeline([
    got.stream(SOURCE),
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) =>
      stream.Readable.from(source).map((feature) => ({
        code: feature.properties.code,
        nom: feature.properties.nom,
        geometry: feature.geometry
      })),
    JSONStream.stringify('[\n', ',\n', '\n]'),
    createWriteStream(outFile)
  ])
}

type Region = Feature<Polygon | MultiPolygon>

function findRegion(regions: FeatureCollection<Polygon | MultiPolygon>, code: string): Region {
  const region = regions.features.find(({ properties }) => properties?.code === code)
  if (!region) throw new Error(`Région ${code} absente du fichier des régions`)
  return region
}

function unionOf(regions: Region[]): Region {
  const result = union(turf.featureCollection(regions))
  if (!result) throw new Error('Union de régions vide')
  return result
}

async function fetchRegionsBoundaries(): Promise<void> {
  // Skip if file already exists
  const files = ['metropole', 'antilles', 'guyane', 'reunion', 'mayotte']
  if (files.every((name) => fs.existsSync(join(generatedDataDirectory, `${name}.json`)))) {
    console.log('Region boundaries files already exist, skipping')
    return
  }

  const FILENAME = 'regions-100m.geojson'
  const SOURCE = 'http://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

  // Get content
  const response = await got(SOURCE)
  const content = response.body

  // Parse content
  const regions: FeatureCollection<Polygon | MultiPolygon> = JSON.parse(content)

  // Get metropole
  const metropoleCodes = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94']
  const metropoleRegions = regions.features.filter(({ properties }) => metropoleCodes.includes(properties?.code))
  const metropole = unionOf(metropoleRegions)

  // Get Antilles
  const antilles = unionOf([findRegion(regions, '01'), findRegion(regions, '02')])

  // Get other droms
  const guyane = regions.features.find(({ properties }) => properties?.code === '03')
  const reunion = regions.features.find(({ properties }) => properties?.code === '04')
  const mayotte = regions.features.find(({ properties }) => properties?.code === '06')

  const outputs = { metropole, antilles, guyane, reunion, mayotte }
  // Dump each file
  for (const [output, data] of Object.entries(outputs)) {
    console.log(`Writing ${output}.json`, data?.type)
    const outputFile = join(generatedDataDirectory, `${output}.json`)
    await pipeline([stream.Readable.from(JSON.stringify(data)), createWriteStream(outputFile)])
  }
}

async function fetchDepartementBoundaries(): Promise<void> {
  // Skip if file already exists
  const outFile = join(referenceDataDirectory, 'departements.json')
  if (fs.existsSync(outFile)) {
    console.log('Departement boundaries file already exists, skipping')
    return
  }

  const FILENAME = 'departements-50m.geojson.gz'
  const SOURCE = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

  return pipeline([
    got.stream(SOURCE),
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) =>
      stream.Readable.from(source).map((feature) => ({
        code: feature.properties.code,
        nom: feature.properties.nom,
        geometry: feature.geometry
      })),
    JSONStream.stringify('[\n', ',\n', '\n]'),
    createWriteStream(outFile)
  ])
}

async function fetchAtOnceRegionsBoundaries(): Promise<void> {
  // Skip if file already exists
  const outFile = join(referenceDataDirectory, 'regions.json')
  if (fs.existsSync(outFile)) {
    console.log('Departement boundaries file already exists, skipping')
    return
  }

  const FILENAME = 'regions-50m.geojson.gz'
  const SOURCE = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

  const goodCodes = [
    '11',
    '24',
    '27',
    '28',
    '32',
    '44',
    '52',
    '53',
    '75',
    '76',
    '84',
    '93',
    '94',
    '01',
    '02',
    '03',
    '04',
    '06'
  ]

  return pipeline([
    got.stream(SOURCE),
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) =>
      stream.Readable.from(source)
        .filter((feature) => goodCodes.includes(feature.properties.code))
        .map((feature) => ({
          code: feature.properties.code,
          nom: feature.properties.nom,
          geometry: feature.geometry
        })),
    JSONStream.stringify('[\n', ',\n', '\n]'),
    createWriteStream(outFile)
  ])
}

;(async function (): Promise<void> {
  await fetchCommunesBoundaries()
  await fetchRegionsBoundaries()
  await fetchDepartementBoundaries()
  await fetchAtOnceRegionsBoundaries()
})()
