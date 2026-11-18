#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { promisify } from 'node:util'
import { createGunzip } from 'node:zlib'
import stream from 'node:stream'
import { join } from 'node:path'
import { DATA_DIR } from '../src/shared/paths.js'
import got from 'got'
import JSONStream from 'jsonstream-next'
import fs from 'node:fs'
import union from '@turf/union'
import * as turf from '@turf/helpers'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'

const pipeline = promisify(stream.pipeline)

const generatedDataDirectory = join(DATA_DIR, 'generated')
const referenceDataDirectory = join(DATA_DIR, 'reference')
const GEO_SOURCE = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2026/geojson/'
const COMMUNES_SHA256 = '6db43cd98a7211516da64e91761100504ba3feeddc986ebe0d50f84df624cd38'
const REGIONS_SHA256 = 'f85fe769841120140cdf0dc8fb9536926ad884157fd8e26f74aec58b18994ba4'

const DEPARTEMENTS_SHA256 = '9ca63cdcca87f9b08a9242db504492cdfca1334ab17336873d8a5b547a24da6d'
const REGIONS_50M_SHA256 = 'f95a49efca51c3343359daecbee5b74f585cfbc97dd3b547599db65a3343a65b'

function assertSha256(actual: string, expected: string, source: string): void {
  if (actual !== expected) throw new Error(`Empreinte SHA-256 inattendue pour ${source} : ${actual}`)
}

async function pipelineVerified(
  source: string,
  expectedSha256: string,
  outFile: string,
  steps: Array<NodeJS.ReadWriteStream | ((source: AsyncIterable<unknown>) => AsyncIterable<unknown>)>
): Promise<void> {
  const hash = createHash('sha256')
  await pipeline([
    got.stream(source),
    async function* (chunks: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
      for await (const chunk of chunks) {
        hash.update(chunk)
        yield chunk
      }
    },
    ...steps,
    createWriteStream(outFile)
  ])

  try {
    assertSha256(hash.digest('hex'), expectedSha256, source)
  } catch (error) {
    await fs.promises.rm(outFile, { force: true })
    throw error
  }
}

async function fetchCommunesBoundaries(): Promise<void> {
  const outFile = join(generatedDataDirectory, 'communes.json')
  if (fs.existsSync(outFile)) {
    console.log('Commune boundaries file already exists, skipping')
    return
  }

  await pipelineVerified(GEO_SOURCE + 'communes-50m.geojson.gz', COMMUNES_SHA256, outFile, [
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) =>
      stream.Readable.from(source).map((feature) => ({
        code: feature.properties.code,
        nom: feature.properties.nom,
        geometry: feature.geometry
      })),
    JSONStream.stringify('[\n', ',\n', '\n]')
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
  const files = ['metropole', 'antilles', 'guyane', 'reunion', 'mayotte']
  if (files.every((name) => fs.existsSync(join(generatedDataDirectory, `${name}.json`)))) {
    console.log('Region boundaries files already exist, skipping')
    return
  }

  const SOURCE = GEO_SOURCE + 'regions-100m.geojson'

  const response = await got(SOURCE)
  assertSha256(createHash('sha256').update(response.rawBody).digest('hex'), REGIONS_SHA256, SOURCE)
  const content = response.body

  const regions: FeatureCollection<Polygon | MultiPolygon> = JSON.parse(content)

  const metropoleCodes = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94']
  const metropoleRegions = regions.features.filter(({ properties }) => metropoleCodes.includes(properties?.code))
  const metropole = unionOf(metropoleRegions)

  const antilles = unionOf([findRegion(regions, '01'), findRegion(regions, '02')])

  const guyane = regions.features.find(({ properties }) => properties?.code === '03')
  const reunion = regions.features.find(({ properties }) => properties?.code === '04')
  const mayotte = regions.features.find(({ properties }) => properties?.code === '06')

  const outputs = { metropole, antilles, guyane, reunion, mayotte }
  for (const [output, data] of Object.entries(outputs)) {
    console.log(`Writing ${output}.json`, data?.type)
    const outputFile = join(generatedDataDirectory, `${output}.json`)
    await pipeline([stream.Readable.from(JSON.stringify(data)), createWriteStream(outputFile)])
  }
}

async function fetchDepartementBoundaries(): Promise<void> {
  const outFile = join(referenceDataDirectory, 'departements.json')
  if (fs.existsSync(outFile)) {
    console.log('Departement boundaries file already exists, skipping')
    return
  }

  await pipelineVerified(GEO_SOURCE + 'departements-50m.geojson.gz', DEPARTEMENTS_SHA256, outFile, [
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) =>
      stream.Readable.from(source).map((feature) => ({
        code: feature.properties.code,
        nom: feature.properties.nom,
        geometry: feature.geometry
      })),
    JSONStream.stringify('[\n', ',\n', '\n]')
  ])
}

async function fetchAtOnceRegionsBoundaries(): Promise<void> {
  const outFile = join(referenceDataDirectory, 'regions.json')
  if (fs.existsSync(outFile)) {
    console.log('Region boundaries file already exists, skipping')
    return
  }

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

  await pipelineVerified(GEO_SOURCE + 'regions-50m.geojson.gz', REGIONS_50M_SHA256, outFile, [
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
    JSONStream.stringify('[\n', ',\n', '\n]')
  ])
}

await fetchCommunesBoundaries()
await fetchRegionsBoundaries()
await fetchDepartementBoundaries()
await fetchAtOnceRegionsBoundaries()
