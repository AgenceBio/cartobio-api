#!/usr/bin/env node

const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const dotenv = require('dotenv')

const cliProgress = require('cli-progress')
const getStream = require('get-stream')
const { post } = require('got')
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
    return Object.fromEntries(
      headers.map((h, i) => [h.toUpperCase(), values[i]])
    )
  })
}

function toCSV (data, delimiter = ';', header = []) {
  if (data.length === 0) return ''
  const headers = [...Object.keys(data[0]), ...header]
  const lines = data.map((obj) =>
    headers.map((h) => obj[h] ?? '').join(delimiter)
  )
  return [headers.join(delimiter), ...lines].join('\n')
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

async function getValidOperator (tabCouplage) {
  try {
    const response = await post(
    `${process.env.NOTIFICATIONS_AB_ENDPOINT}/api/operateur/siret-pacage`,
    {
      headers: {
        Authorization: process.env.NOTIFICATIONS_AB_SERVICE_TOKEN,
        origin: process.env.NOTIFICATIONS_AB_ORIGIN
      },
      json: tabCouplage,
      timeout: { request: 10000 },
      retry: { limit: 3, methods: ['GET', 'POST'], errorCodes: ['EPIPE', 'ECONNRESET', 'ETIMEDOUT'] }
    }
    ).json()
    return response
  } catch (e) {
    console.error(e)
  }
}

function splitToNTabs (array, n) {
  const result = []
  for (let i = n; i > 0; i--) {
    result.push(array.splice(0, Math.ceil(array.length / i)))
  }
  return result
}

/* main.js */

if (process.argv.length < 4) {
  console.error(
    'Usage: node import-pac.js <fichier-zip-asp> <correspondance.csv>'
  )
  process.exit(1)
}

(async () => {
  const aspFile = process.argv[2]
  const csvFile = process.argv[3]
  dotenv.config({ path: process.argv[4] })

  const zipBuffer = await getStream.buffer(fs.createReadStream(aspFile))
  const { files, cleanup } = await unzipGeographicalContent(zipBuffer)
  const correspondance = parseCSV(fs.readFileSync(csvFile, 'utf8'))
  const exportNoCorrespondance = []

  const client = await pool.connect()
  await client.query('BEGIN;')

  const progress = new cliProgress.SingleBar(
    {},
    { ...cliProgress.Presets.rect, etaBuffer: 10000 }
  )
  progress.start(correspondance.length, 0)

  let imported = 0
  let skipped = 0
  const warningsDoublon = []
  const warningsCorrespondance = []
  const warningsSiretVide = []
  const warningsNoNumeroBio = []
  try {
    for await (const filepath of files) {
      const dataset = await gdal.openAsync(filepath)

      for await (const layer of dataset.layers) {
        const srs = await detectSrs(layer)
        const reproject = new gdal.CoordinateTransformation(srs, wgs84)
        const tabCouplage = []
        const tabGeom = []
        const group = groupByPACAGE(layer.features)
        for await (const featureGroup of group) {
          const pacage = featureGroup[0].fields.toObject().PACAGE
          const siretMapping = correspondance.find(
            (row) => row.PACAGE === pacage
          )

          if (!siretMapping) {
            warningsCorrespondance.push(pacage)
            skipped++
            progress.increment()

            continue
          }

          if (siretMapping.SIRET === '') {
            warningsSiretVide.push(siretMapping.PACAGE)
            skipped++
            exportNoCorrespondance.push(
              correspondance.find(
                (e) => e.PACAGE === siretMapping.PACAGE && e.SIRET === siretMapping.SIRET
              ))
            progress.increment()
            continue
          }

          tabCouplage.push({
            siret: siretMapping.SIRET,
            pacage: siretMapping.PACAGE
          })
          tabGeom.push({
            pacage: siretMapping.PACAGE,
            geom: featureGroup
          })
        }
        const splitTab = splitToNTabs([...tabCouplage], Math.round(tabCouplage.length / 30))

        for (let i = 0; i < splitTab.length; i++) {
          const data = await getValidOperator(splitTab[i])
          if (data.doublons.length > 0) {
            for (const doublon of data.doublons) {
              warningsDoublon.push({
                siret: doublon.siret,
                pacage: doublon.pacage
              })
            }
            skipped = skipped + data.doublons.length
          }
          if (data.sansOperateur.length > 0) {
            for (const so of data.sansOperateur) {
              warningsNoNumeroBio.push({ siret: so.siret, pacage: so.pacage })
              exportNoCorrespondance.push(
                correspondance.find(
                  (e) => e.PACAGE === so.pacage && e.SIRET === so.siret
                )
              )
            }
            skipped = skipped + data.sansOperateur.length
          }
          for (const operator of data.operateurs) {
            const pacageFeatures = tabGeom.find(
              (e) => e.pacage === operator.numeroPacage
            ).geom

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
                  PACAGE: operator.numeroPacage
                }
              })
            }

            const record = {
              parcelles: featureCollection,
              numerobio: operator.numeroBio,
              certification_state: CertificationState.OPERATOR_DRAFT,
              version_name: 'Parcellaire déclaré PAC 2025',
              metadata: {
                source: 'telepac',
                campagne: '2025',
                pacage: operator.numeroPacage,
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
                operator.numeroBio,
                featureCollection.features.length,
                await surfaceForFeatureCollection(featureCollection),
                JSON.stringify(record),
                operator.numeroPacage,
                operator.siret
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
    if (warningsDoublon.length > 0) {
      console.log(
        '\n Warnings =>  Couple Siret / Pacage avec plusieurs numéros Bio'
      )
      console.table(warningsDoublon)
    }
    if (warningsNoNumeroBio.length > 0) {
      console.log('\n Warnings => Couple Siret / Pacage sans numéros Bio ')
      console.table(warningsNoNumeroBio)
    }
    if (warningsCorrespondance.length > 0) {
      console.log('\n Warnings => Aucune correspondance pour les pacages : ')
      for (const wc of warningsCorrespondance) console.log(wc)
    }
    if (warningsSiretVide.length > 0) {
      console.log('\n Warnings => Numero de siret à vide pour les pacages :')
      for (const wsv of warningsSiretVide) console.log(wsv)
    }

    console.log('--- Résumé ---')
    console.log('Importés :', imported)
    console.log('Ignorés :', skipped)

    const json = {
      success: imported,
      skipped: skipped,
      warningsCorrespondance,
      warningsDoublon,
      warningsNoNumeroBio,
      warningsSiretVide
    }
    fs.writeFile('resultat.json', JSON.stringify(json), 'utf8', (err) => {
      if (err) {
        console.error(err)
      } else {
        console.log('Warnings disponible dans le fichier resultat.json')
      }
    })
    if (exportNoCorrespondance.length > 0) {
      const outputCsv = toCSV(exportNoCorrespondance, ';', ['NUMEROBIO'])
      fs.writeFileSync('lignes_sans_numerobio.csv', outputCsv, 'utf8')
      console.log(
        'Correctifs à faire disponible dans le fichier lignes_sans_numerobio.csv'
      )
    }
  }
})()
