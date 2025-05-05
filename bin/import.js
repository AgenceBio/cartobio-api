#!/usr/bin/env node

const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const dotenv = require('dotenv')

const cliProgress = require('cli-progress')
const getStream = require('get-stream')
const { get } = require('got')
const gdal = require('gdal-async')
const area = require('@turf/area')

const pool = require('../lib/db')
const { normalizeOperator } = require('../lib/outputs/operator.js')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { unzipGeographicalContent, detectSrs, wgs84 } = require('../lib/providers/gdal')
const { getRandomFeatureId } = require('../lib/outputs/features')
const { CertificationState, EtatProduction } = require('../lib/enums.js')

// Constante
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

function parseCSV (text) {
  const [headerLine, ...lines] = text.trim().split('\n')
  const headers = headerLine.split(';').map(h => h.trim())
  return lines.map(line => {
    const values = line.split(';').map(v => v.trim())
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]))
  })
}

async function * groupByPACAGE (features) {
  const sorted = Array.from(features).sort((a, b) => a.fields.get('PACAGE').localeCompare(b.fields.get('PACAGE')))
  let current = null
  let group = []

  for (const feature of sorted) {
    const pacage = feature.fields.get('PACAGE')
    if (!pacage) throw new Error(`Feature without PACAGE: ${JSON.stringify(feature.fields.toObject())}`)

    if (!current || pacage === current) {
      group.push(feature)
    } else {
      yield group
      group = [feature]
    }

    current = pacage
  }

  if (group.length) yield group
}

async function getNumerobioBySiretID (ocId, siret, pacage) {
  const response = await get(`${process.env.NOTIFICATIONS_AB_ENDPOINT}/api/oc/${ocId}/operateurs?siret=${siret}&pacage=${pacage}`, {
    headers: {
      Authorization: process.env.NOTIFICATIONS_AB_SERVICE_TOKEN,
      origin: process.env.NOTIFICATIONS_AB_ORIGIN
    }
  }).json()

  response.operateurs = response.operateurs.map(normalizeOperator)
  return response
}

async function findOperatorBySiret (siret, pacage) {
  for (const [, ocId] of Object.entries(OC)) {
    const data = await getNumerobioBySiretID(ocId, siret, pacage)
    if (data.nbTotal === 1) {
      return data.operateurs[0]
    }
  }
  return null
}

/* main.js */

if (process.argv.length < 4) {
  console.error('Usage: node import-pac-declare.js <fichier-zip-asp> <correspondance.csv> [env]')
  process.exit(1)
}

(async () => {
  const aspFile = process.argv[2]
  const csvFile = process.argv[3]
  dotenv.config({ path: process.argv[4] })

  const zipBuffer = await getStream.buffer(fs.createReadStream(aspFile))
  const { files, cleanup } = await unzipGeographicalContent(zipBuffer)
  const correspondance = parseCSV(fs.readFileSync(csvFile, 'utf8'))

  const client = await pool.connect()
  await client.query('BEGIN;')

  await client.query(`
    CREATE TABLE IF NOT EXISTS import_pac (
      id SERIAL PRIMARY KEY,
      numerobio VARCHAR NOT NULL,
      pacage VARCHAR NOT NULL,
      siret VARCHAR NOT NULL,
      nb_parcelles VARCHAR NOT NULL,
      size VARCHAR NOT NULL,
      record JSONB NOT NULL,
      imported BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE(numerobio, pacage, siret)
    );
  `)

  const progress = new cliProgress.SingleBar({}, { ...cliProgress.Presets.rect, etaBuffer: 10000 })
  progress.start(correspondance.length, 0)

  let imported = 0
  let skipped = 0
  const warnings = []

  try {
    for await (const filepath of files) {
      const dataset = await gdal.openAsync(filepath)

      for await (const layer of dataset.layers) {
        const srs = await detectSrs(layer)
        const reproject = new gdal.CoordinateTransformation(srs, wgs84)

        for await (const featureGroup of groupByPACAGE(layer.features)) {
          const pacage = featureGroup[0].fields.get('PACAGE')
          const siretMapping = correspondance.find(row => row.NUMEROPACAGE === pacage)

          if (!siretMapping) {
            warnings.push(`Aucune correspondance pour le numéro de pacage : ${pacage}`)
            skipped++
            continue
          }

          const operator = await findOperatorBySiret(siretMapping.NUMEROSIRET, pacage)
          if (!operator) {
            warnings.push(`Aucun numéro Bio pour le SIRET : ${siretMapping.NUMEROSIRET} et le pacage : ${pacage}`)
            continue
          }

          const featureCollection = {
            type: 'FeatureCollection',
            features: []
          }

          for (const feature of featureGroup) {
            const geometry = feature.getGeometry()
            await geometry.transformAsync(reproject)

            const fields = feature.fields.toObject()
            const { BIO, CODE_CULT, PRECISION, NUM_ILOT, NUM_PARCEL } = fields
            const id = feature.fields.get('IUP') || getRandomFeatureId()

            featureCollection.features.push({
              type: 'Feature',
              id,
              geometry: geometry.toObject(),
              properties: {
                id,
                BIO,
                cultures: [{
                  id: randomUUID(),
                  CPF: fromCodePacStrict(CODE_CULT, PRECISION)?.code_cpf,
                  CODE_CULT
                }],
                conversion_niveau: BIO === 1 ? EtatProduction.BIO : EtatProduction.NB,
                NUMERO_I: NUM_ILOT,
                NUMERO_P: NUM_PARCEL,
                PACAGE: pacage
              }
            })
          }

          const record = {
            parcelles: featureCollection,
            numerobio: operator.numeroBio,
            oc_label: operator.organismeCertificateur.nom,
            oc_id: operator.organismeCertificateur.id,
            certification_state: CertificationState.OPERATOR_DRAFT,
            version_name: 'Parcellaire déclaré PAC 2025',
            metadata: {
              source: 'telepac',
              campagne: '2025',
              pacage,
              warnings: '',
              provenance: 'asp-2025'
            }
          }

          await client.query(`
            INSERT INTO import_pac (numerobio, nb_parcelles, size, record, pacage, siret)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (numerobio, pacage, siret)
            DO UPDATE SET record = $7
          `, [
            operator.numeroBio,
            featureCollection.features.length,
            area.default(featureCollection),
            JSON.stringify(record),
            pacage,
            siretMapping.NUMEROSIRET,
            JSON.stringify(record)
          ])

          imported++
          progress.increment()
        }
      }
    }

    await client.query('COMMIT;')
  } catch (error) {
    await client.query('ROLLBACK;')
    console.error(error)
    process.exit(1)
  } finally {
    await client.release()
    await cleanup()
    progress.stop()

    console.log('--- Résumé ---')
    console.log('Importés :', imported)
    console.log('Ignorés :', skipped)
    if (warnings.length) {
      console.warn('\n Warnings:')
      for (const msg of warnings) console.warn(msg)
    }
  }
})()
