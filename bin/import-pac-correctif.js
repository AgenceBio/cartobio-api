#!/usr/bin/env node

const fs = require('node:fs')
const { randomUUID } = require('node:crypto')

const cliProgress = require('cli-progress')
const getStream = require('get-stream')
const gdal = require('gdal-async')

const pool = require('../lib/db')
const { surfaceForFeatureCollection } = require('../lib/outputs/api.js')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const {
  unzipGeographicalContent,
  detectSrs,
  wgs84
} = require('../lib/providers/gdal')
const { getRandomFeatureId } = require('../lib/outputs/features')
const { CertificationState, EtatProduction } = require('../lib/enums.js')

function parseCSV (text) {
  const [headerLine, ...lines] = text.trim().split('\n')
  const headers = headerLine.split(';').map((h) => h.trim())
  return lines.map((line) => {
    const values = line.split(';').map((v) => v.trim())
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]))
  })
}

function groupByPACAGE (features) {
  const groups = new Map()

  for (const feature of features) {
    const pacage = feature.fields.get('PACAGE')
    if (!pacage) {
      throw new Error(
        `Feature without PACAGE: ${JSON.stringify(feature.fields.toObject())}`
      )
    }

    if (!groups.has(pacage)) {
      groups.set(pacage, [])
    }

    groups.get(pacage).push(feature)
  }

  return Array.from(groups.values())
}

/* main.js */

if (process.argv.length < 3) {
  console.error(
    'Usage: node import-pac-correctif.js <fichier-zip-asp> <correspondance-correctif.csv>'
  )
  process.exit(1)
}

(async () => {
  const aspFile = process.argv[2]
  const csvFile = process.argv[3]

  const zipBuffer = await getStream.buffer(fs.createReadStream(aspFile))
  const { files, cleanup } = await unzipGeographicalContent(zipBuffer)
  const correspondance = parseCSV(fs.readFileSync(csvFile, 'utf8'))

  const client = await pool.connect()
  await client.query('BEGIN;')

  const progress = new cliProgress.SingleBar(
    {},
    { ...cliProgress.Presets.rect, etaBuffer: 10000 }
  )
  progress.start(correspondance.length, 0)

  let imported = 0
  let skipped = 0
  const warningsCorrespondance = []
  const warningsSiretVide = []
  const warningsNumeroBioVide = []
  try {
    for await (const filepath of files) {
      const dataset = await gdal.openAsync(filepath)

      for await (const layer of dataset.layers) {
        const srs = await detectSrs(layer)
        const reproject = new gdal.CoordinateTransformation(srs, wgs84)
        const tabCouplage = []
        const group = groupByPACAGE(layer.features)
        for await (const featureGroup of group) {
          const pacage = featureGroup[0].fields.get('PACAGE')
          const siretMapping = correspondance.find(
            (row) => row.PACAGE === pacage
          )

          if (!siretMapping) {
            warningsCorrespondance.push(pacage)
            skipped++
            continue
          }

          if (siretMapping.SIRET === '' && siretMapping.NUMEROBIO === '') {
            warningsSiretVide.push(siretMapping.PACAGE)
            skipped++
            continue
          }

          if (siretMapping.NUMEROBIO === '') {
            warningsNumeroBioVide.push({
              siret: siretMapping.SIRET,
              pacage: siretMapping.PACAGE
            })
            skipped++
            continue
          }
          tabCouplage.push({
            siret: siretMapping.SIRET,
            pacage: siretMapping.PACAGE,
            numeroBio: siretMapping.NUMEROBIO,
            geom: featureGroup
          })
        }
        if (tabCouplage.length > 0) {
          for (let i = 0; i < tabCouplage.length; i++) {
            const pacageFeatures = tabCouplage[i].geom

            const featureCollection = {
              type: 'FeatureCollection',
              features: []
            }

            for (const feature of pacageFeatures) {
              const names = feature.fields.getNames()
              const geometry = feature.getGeometry()
              await geometry.transformAsync(reproject)

              const fields = feature.fields.toObject()
              const { BIO, CODE_CULT, PRECISION, NUM_ILOT, NUM_PARCEL } =
                fields
              const id = names.includes('id') ? feature.fields.get('id') : getRandomFeatureId()

              featureCollection.features.push({
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
                  conversion_niveau:
                    BIO === 1 ? EtatProduction.BIO : EtatProduction.NB,
                  NUMERO_I: NUM_ILOT,
                  NUMERO_P: NUM_PARCEL,
                  TYPE: CODE_CULT,
                  CODE_VAR: PRECISION,
                  PACAGE: tabCouplage[i].pacage
                }
              })
            }

            const record = {
              parcelles: featureCollection,
              numerobio: tabCouplage[i].numeroBio,
              certification_state: CertificationState.OPERATOR_DRAFT,
              version_name: 'Parcellaire déclaré PAC 2025',
              metadata: {
                source: 'telepac',
                campagne: '2025',
                pacage: tabCouplage[i].pacage,
                warnings: '',
                provenance: 'asp-2025'
              }
            }
            await client.query(
              `
            INSERT INTO import_pac (numerobio, nb_parcelles, size, record, pacage, siret)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (numerobio, pacage, siret)
            DO UPDATE SET nb_parcelles = $2, size = $3, record = $4, updatedAt = CURRENT_TIMESTAMP
          `,
              [
                tabCouplage[i].numeroBio,
                featureCollection.features.length,
                await surfaceForFeatureCollection(featureCollection),
                JSON.stringify(record),
                tabCouplage[i].pacage,
                tabCouplage[i].siret
              ]
            )

            imported++
            progress.increment()
          }
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

    console.warn('\n Warnings:')
    if (warningsCorrespondance.length > 0) {
      console.log('\n Warnings => Aucune correspondance pour les pacages : ')
      for (const wc of warningsCorrespondance) console.log(wc)
    }
    if (warningsSiretVide.length > 0) {
      console.log('\n Warnings =>Numero de siret à vide pour les pacages :')
      for (const wsv of warningsSiretVide) console.log(wsv)
    }

    if (warningsNumeroBioVide.length > 0) {
      console.log(
        '\n Warnings =>Numero BIO à vide pour les pacages et les sirets :'
      )
      for (const wsv of warningsNumeroBioVide) console.log(wsv)
    }

    console.log('--- Résumé ---')
    console.log('Importés :', imported)
    console.log('Ignorés :', skipped)

    const json = {
      success: imported,
      skipped: skipped,
      warningsCorrespondance,
      warningsSiretVide,
      warningsNumeroBioVide
    }
    fs.writeFile(
      'resultat_correctif_csv.json',
      JSON.stringify(json),
      'utf8',
      (err) => {
        if (err) {
          console.error(err)
        } else {
          console.log('Warnings disponible dans le fichier resultat.json')
        }
      }
    )
  }
})()
