#!/usr/bin/env node

const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const cliProgress = require('cli-progress')
const { parse } = require('csv-parse/sync')
const getStream = require('get-stream')
const gdal = require('gdal-async')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')

const { createOrUpdateOperatorRecord } = require('../lib/providers/cartobio')
const { CertificationState, EtatProduction } = require('../lib/enums.js')
const pool = require('../lib/db')
const { unzipGeographicalContent, detectSrs, wgs84 } = require('../lib/providers/gdal')
const { getRandomFeatureId } = require('../lib/outputs/features')

/**
 * Ce script lit la grande FeatureCollection des parcellaires déclarés de l'ASP
 * et la découpe en FeatureCollection plus petites, regroupées par PACAGE.
 *
 * Il le lie ensuite aux données des opérateurs fournies par l'AgenceBio
 */

const OC = {
  'Ecocert France': 1,
  'Bureau Veritas Certification France': 2,
  'Certipaq Bio': 3,
  Qualisud: 4,
  Certisud: 5,
  Certis: 6,
  'Bureau Alpes contrôles': 7,
  'Biotek Agriculture': 8,
  'Control Union Inspections France': 10,
  Ocacia: 11
}

async function * groupByPACAGE (features) {
  let recordFeatures = []
  let currentPACAGE = null
  for await (const feature of features) {
    // group features by properties.PACAGE
    const properties = feature.fields.toObject()
    const { PACAGE } = properties
    if (!PACAGE) {
      throw new Error('Feature without PACAGE:', feature)
    }

    if (!currentPACAGE || PACAGE === currentPACAGE) {
      recordFeatures.push(feature)
    } else {
      yield recordFeatures
      recordFeatures = [feature]
    }

    currentPACAGE = PACAGE
  }
}

if (process.argv.length < 4) {
  console.error('Usage: node import-pac-declare.js cartobio-tas2024_12062024.zip correspondance_operateurs.csv')
  process.exit(1)
}
(async () => {
  const aspFilename = process.argv[2]
  const correspondanceFilename = process.argv[3]

  /**
   * Assuming the file is a GeoJson FeatureCollection,
   * read the file and stream it into JSONStream
   */
  const fsStream = fs.createReadStream(aspFilename)
  console.log('Unzipping file...')
  const { files, cleanup } = await unzipGeographicalContent(await getStream.buffer(fsStream))

  /**
   * Load into memory the correspondance_operateurs.csv
   */
  const correspondance = parse(fs.readFileSync(correspondanceFilename, 'utf8'), {
    columns: true
  })

  const progress = new cliProgress.SingleBar({}, {
    ...cliProgress.Presets.shades_classic,
    etaBuffer: 10000
  })

  const client = await pool.connect()
  await client.query('BEGIN;')

  let i = 0
  let skipped = 0
  progress.start(correspondance.length, 0)
  try {
    for await (const filepath of files) {
      const dataset = await gdal.openAsync(filepath)

      for await (const layer of dataset.layers) {
        const srs = await detectSrs(layer)
        const reprojectFn = new gdal.CoordinateTransformation(srs, wgs84)

        for await (const features of groupByPACAGE(layer.features)) {
          const pacage = features[0].fields.toObject().PACAGE
          // eslint-disable-next-line camelcase
          const operator = correspondance.find(({ pacage_asp }) => pacage_asp === pacage)
          if (!operator) {
            skipped++
            continue
          }

          const featureCollection = {
            type: 'FeatureCollection',
            features: []
          }

          for (const feature of features) {
            const names = feature.fields.getNames()
            const geometry = feature.getGeometry()
            await geometry.transformAsync(reprojectFn)
            const id = names.includes('id') ? feature.fields.get('id') : getRandomFeatureId()
            const properties = feature.fields.toObject()

            const { BIO, CODE_CULT, PRECISION, NUM_ILOT: NUMERO_I, NUM_PARCEL: NUMERO_P, PACAGE } = properties

            featureCollection.features.push(/** @type {Feature} */{
              type: 'Feature',
              id,
              geometry: geometry.toObject(),
              properties: {
                id,
                BIO,
                cultures: [
                  {
                    id: randomUUID(),
                    CPF: fromCodePacStrict(CODE_CULT, PRECISION)?.code_cpf,
                    CODE_CULT
                  }
                ],
                conversion_niveau: BIO === 1 ? EtatProduction.BIO : EtatProduction.NB,
                NUMERO_I,
                NUMERO_P,
                PACAGE
              }
            })
          }

          /**
           * @type {import('../outputs/types/record').NormalizedRecord}
           */
          const record = {
            parcelles: featureCollection,
            numerobio: operator.numerobio,
            oc_label: operator.nomoc,
            oc_id: OC[operator.nomoc],
            certification_state: CertificationState.OPERATOR_DRAFT,
            version_name: 'Parcellaire déclaré PAC 2024',
            metadata: {
              source: 'telepac',
              campagne: '2024',
              pacage,
              warnings: '',
              provenance: 'asp-2024'
            }
          }

          await createOrUpdateOperatorRecord(record, { copyParcellesData: true }, client)
          i++
          progress.increment()
        }
      }
    }
  } catch (error) {
    await client.query('ROLLBACK;')
    console.error(error)
    process.exit(1)
  } finally {
    await client.query('COMMIT;')
    await client.release()
  }

  progress.stop()
  await cleanup()

  console.log('Imported', i, 'records')
  console.log('Skipped', skipped, 'records because of missing operator correspondance')
})()
