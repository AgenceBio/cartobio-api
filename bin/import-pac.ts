#!/usr/bin/env node

import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'

import cliProgress from 'cli-progress'
import getStream from 'get-stream'
import gotModule from 'got'
const got = gotModule.default
const { post } = got
import gdal from 'gdal-async'
import type { Feature } from 'geojson'

import { withTransaction } from '../src/database/transaction.js'
import { surfaceForFeatureCollection } from '../src/shared/outputs/api.js'
import { fromCodePacStrict } from '@agencebio/rosetta-cultures'
import { unzipGeographicalContent, detectSrs, wgs84 } from '../src/shared/geo/gdal.js'
import { getRandomFeatureId } from '../src/shared/outputs/features.js'
import { CertificationState, EtatProduction } from '@agencebio/cartobio-types'
import type { AgenceBioOperator } from '@agencebio/cartobio-types'

function parseCSV(text: string): Record<string, string>[] {
  const [headerLine, ...lines] = text.trim().split('\n')
  const headers = headerLine.split(';').map((h) => h.trim())
  return lines.map((line) => {
    const values = line.split(';').map((v) => v.trim())
    return Object.fromEntries(
      headers.map((h, i) => [h.toUpperCase(), values[i]])
    )
  })
}

function toCSV(data: Array<Record<string, string>>, delimiter = ';', header: string[] = []) {
  if (data.length === 0) return ''
  const headers = [...Object.keys(data[0]), ...header]
  const lines = data.map((obj) =>
    headers.map((h) => obj[h] ?? '').join(delimiter)
  )
  return [headers.join(delimiter), ...lines].join('\n')
}

function groupByPACAGE(features: Iterable<gdal.Feature>): gdal.Feature[][] {
  const groups = new Map<string, gdal.Feature[]>()

  for (const feature of features) {
    const pacage = feature.fields.get('PACAGE')
    if (!pacage) {
      throw new Error(
        `Feature without PACAGE: ${JSON.stringify(feature.fields.toObject())}`
      )
    }

    let group = groups.get(pacage)
    if (!group) {
      group = []
      groups.set(pacage, group)
    }

    group.push(feature)
  }

  return Array.from(groups.values())
}

interface SiretPacage {
  siret: string
  pacage: string
}

interface ValidOperatorsResponse {
  doublons: SiretPacage[]
  sansOperateur: SiretPacage[]
  operateurs: AgenceBioOperator[]
}

async function getValidOperator(tabCouplage: SiretPacage[]): Promise<ValidOperatorsResponse | undefined> {
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
    ).json<ValidOperatorsResponse>()
    return response
  } catch (e) {
    console.error(e)
  }
}

function splitToNTabs<T>(array: T[], n: number): T[][] {
  const result: T[][] = []
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

(async (): Promise<void> => {
  const aspFile = process.argv[2]
  const csvFile = process.argv[3]
  dotenv.config({ path: process.argv[4] })

  const zipBuffer = await getStream.buffer(fs.createReadStream(aspFile))
  const { files, cleanup } = await unzipGeographicalContent(zipBuffer)
  const correspondance = parseCSV(fs.readFileSync(csvFile, 'utf8'))
  const exportNoCorrespondance: Array<Record<string, string>> = []

  const progress = new cliProgress.SingleBar({ etaBuffer: 10000 }, cliProgress.Presets.rect)
  progress.start(correspondance.length, 0)

  let imported = 0
  let skipped = 0
  const warningsDoublon: SiretPacage[] = []
  const warningsCorrespondance: string[] = []
  const warningsSiretVide: string[] = []
  const warningsNoNumeroBio: SiretPacage[] = []
  try {
    await withTransaction(async (client): Promise<void> => {
      for await (const filepath of files) {
        const dataset = await gdal.openAsync(filepath)

        for await (const layer of dataset.layers) {
          const srs = await detectSrs(layer)
          const reproject = new gdal.CoordinateTransformation(srs, wgs84)
          const tabCouplage: SiretPacage[] = []
          const tabGeom: Array<{ pacage: string; geom: gdal.Feature[] }> = []
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
              const ligneSiretVide = correspondance.find(
                (e) => e.PACAGE === siretMapping.PACAGE && e.SIRET === siretMapping.SIRET
              )
              if (ligneSiretVide) exportNoCorrespondance.push(ligneSiretVide)
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
            if (!data) throw new Error('Échec de la récupération des opérateurs (siret-pacage)')
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
                const ligneSansOperateur = correspondance.find(
                  (e) => e.PACAGE === so.pacage && e.SIRET === so.siret
                )
                if (ligneSansOperateur) exportNoCorrespondance.push(ligneSansOperateur)
              }
              skipped = skipped + data.sansOperateur.length
            }
            for (const operator of data.operateurs) {
              const pacageGeom = tabGeom.find(
                (e) => e.pacage === operator.numeroPacage
              )
              if (!pacageGeom) throw new Error(`PACAGE ${operator.numeroPacage} renvoyé par l'API absent du fichier`)
              const pacageFeatures = pacageGeom.geom

              const featureCollection = {
                type: 'FeatureCollection',
                features: [] as Feature[]
              }

              for (const feature of pacageFeatures) {
                const names = feature.fields.getNames()
                const geometry = feature.getGeometry()
                if (!geometry) throw new Error(`Parcelle sans géométrie (PACAGE ${feature.fields.get('PACAGE')})`)
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
                version_name: 'Parcellaire déclaré PAC 2026',
                metadata: {
                  source: 'telepac',
                  campagne: '2026',
                  pacage: operator.numeroPacage,
                  warnings: '',
                  provenance: 'asp-2026'
                }
              }
              await client.query(
                `
              INSERT INTO import_pac_26 (numerobio, nb_parcelles, size, record, pacage, siret)
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

    })
  } catch (error) {
    console.error(error)
    process.exit(1)
  } finally {
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
    fs.writeFile('resultat.json', JSON.stringify(json), 'utf8', (err): void => {
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
