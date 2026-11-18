#!/usr/bin/env node

import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

import cliProgress from 'cli-progress'
import getStream from 'get-stream'
import gdal from 'gdal-async'
import type { Feature } from 'geojson'

import { withTransaction } from '../src/database/transaction.js'
import { surfaceForFeatureCollection } from '../src/shared/outputs/api.js'
import { fromCodePacStrict } from '@agencebio/rosetta-cultures'
import { unzipGeographicalContent, detectSrs, wgs84 } from '../src/shared/geo/gdal.js'
import { getRandomFeatureId } from '../src/shared/outputs/features.js'
import { CertificationState, EtatProduction } from '@agencebio/cartobio-types'

function parseCSV (text: string): Record<string, string>[] {
  const [headerLine, ...lines] = text.trim().split('\n')
  const headers = headerLine.split(';').map((h) => h.trim())
  return lines.map((line) => {
    const values = line.split(';').map((v) => v.trim())
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]))
  })
}

function groupByPACAGE (features: Iterable<gdal.Feature>): gdal.Feature[][] {
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

/* main.js */

if (process.argv.length < 3) {
  console.error(
    'Usage: node import-pac-correctif.js <fichier-zip-asp> <correspondance-correctif.csv>'
  )
  process.exit(1)
}

(async (): Promise<void> => {
  const aspFile = process.argv[2]
  const csvFile = process.argv[3]

  const zipBuffer = await getStream.buffer(fs.createReadStream(aspFile))
  const { files, cleanup } = await unzipGeographicalContent(zipBuffer)
  const correspondance = parseCSV(fs.readFileSync(csvFile, 'utf8'))

  const progress = new cliProgress.SingleBar({ etaBuffer: 10000 }, cliProgress.Presets.rect)
  progress.start(correspondance.length, 0)

  let imported = 0
  let skipped = 0
  const warningsCorrespondance: string[] = []
  const warningsSiretVide: string[] = []
  const warningsNumeroBioVide: Array<{ siret: string; pacage: string }> = []
  try {
    await withTransaction(async (client): Promise<void> => {
      for await (const filepath of files) {
        const dataset = await gdal.openAsync(filepath)

        for await (const layer of dataset.layers) {
          const srs = await detectSrs(layer)
          const reproject = new gdal.CoordinateTransformation(srs, wgs84)
          const tabCouplage: Array<{ siret: string; pacage: string; numeroBio: string; geom: gdal.Feature[] }> = []
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
                    PACAGE: tabCouplage[i].pacage
                  }
                })
              }

              const record = {
                parcelles: featureCollection,
                numerobio: tabCouplage[i].numeroBio,
                certification_state: CertificationState.OPERATOR_DRAFT,
                version_name: 'Parcellaire déclaré PAC 2026',
                metadata: {
                  source: 'telepac',
                  campagne: '2026',
                  pacage: tabCouplage[i].pacage,
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

    })
  } catch (error) {
    console.error(error)
    process.exit(1)
  } finally {
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
      (err): void => {
        if (err) {
          console.error(err)
        } else {
          console.log('Warnings disponible dans le fichier resultat.json')
        }
      }
    )
  }
})()
