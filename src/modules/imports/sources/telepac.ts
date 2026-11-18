import { randomUUID } from 'node:crypto'
import gdal from 'gdal-async'
import { getStreamAsBuffer } from 'get-stream'
import { fileTypeFromBuffer } from 'file-type'
import { XMLParser } from 'fast-xml-parser'
import { z } from 'zod'
import { featureCollection, feature as Feature } from '@turf/helpers'
import { fromCodePacStrict } from '@agencebio/rosetta-cultures'
import reproject from 'reproject'
import { EtatProduction, LegalProjections } from '@agencebio/cartobio-types'
import type { FeatureCollection } from 'geojson'
import type { MultipartFile } from '@fastify/multipart'
import { InvalidRequestApiError } from '../../../shared/errors.js'
import { GEO_DRIVERS, detectSrs, unzipGeographicalContent, wgs84 } from '../../../shared/geo/gdal.js'
import { getRandomFeatureId } from '../../../shared/outputs/features.js'

const { toWgs84 } = reproject

const gmlLinearRingSchema = z.looseObject({
  'gml:LinearRing': z.looseObject({ 'gml:coordinates': z.string() })
})

const gmlPolygonSchema = z.looseObject({
  'gml:outerBoundaryIs': gmlLinearRingSchema,
  'gml:innerBoundaryIs': z.array(gmlLinearRingSchema).optional()
})

type GmlPolygon = z.infer<typeof gmlPolygonSchema>

const telepacXmlParcelleSchema = z.looseObject({
  'descriptif-parcelle': z.looseObject({
    '@_numero-parcelle': z.string(),
    'agri-bio': z.looseObject({ '@_conduite-bio': z.string().optional() }).optional(),
    'culture-principale': z.looseObject({
      'code-culture': z.string(),
      precision: z.string().optional()
    })
  }),
  geometrie: z.looseObject({ 'gml:Polygon': gmlPolygonSchema })
})

const telepacXmlIlotSchema = z.looseObject({
  '@_numero-ilot': z.string(),
  commune: z.string().optional(),
  parcelles: z.looseObject({ parcelle: z.array(telepacXmlParcelleSchema) })
})

const telepacXmlSchema = z.looseObject({
  producteurs: z.looseObject({
    producteur: z.looseObject({
      '@_numero-pacage': z.string(),
      rpg: z
        .looseObject({
          ilot: z.array(telepacXmlIlotSchema).optional(),
          ilots: z.looseObject({ ilot: z.array(telepacXmlIlotSchema) }).optional()
        })
        .refine((rpg) => rpg.ilot ?? rpg.ilots, { message: 'Aucun îlot dans le fichier' })
    })
  })
})

const telepacPropertiesSchema = z.looseObject({
  AGRIBIO: z.int().min(0).max(1).optional(),
  CAMPAGNE: z.int(),
  COMMUNE: z.string().optional(),
  NUMERO_I: z.int(),
  NUMERO_P: z.int(),
  PACAGE: z.string().regex(/^[A-Z0-9]{8,9}$/u),
  TYPE: z.string().regex(/^[A-Z0-9]{3}$/u),
  CODE_VAR: z.string().nullish()
})

const removeEmptyElements = (item: unknown): unknown => item

async function parseTelepacArchive(file: Promise<MultipartFile | undefined>): Promise<FeatureCollection> {
  const data = await file
  if (!data) throw new InvalidRequestApiError('Aucun fichier transmis.')
  const buffer = await getStreamAsBuffer(data.file)

  if ((await fileTypeFromBuffer(buffer))?.mime === 'application/zip') {
    return fromShapefileArchive(buffer)
  }

  const content = buffer.toString('utf-8')
  if (content.includes('<rpg>')) {
    return fromXMLFile(content)
  }

  throw new InvalidRequestApiError('Format de fichier non-reconnu.')
}

/**
 * Parse a Telepac Shapefile archive to GeoJSON
 */
async function fromShapefileArchive(buffer: Buffer): Promise<FeatureCollection> {
  const { files, cleanup } = await unzipGeographicalContent(buffer)
  const featureCollection: FeatureCollection = {
    type: 'FeatureCollection',
    features: []
  }

  try {
    if (!files.length) {
      throw new InvalidRequestApiError(
        'Il ne s\'agit pas d\'un fichier Telepac "Parcelles déclarées" ou "Parcelles instruites".'
      )
    }

    // validateSchema(geojson.features)
    for await (const filepath of files) {
      const dataset = await gdal.openAsync(filepath, 'r', GEO_DRIVERS)

      try {
        for await (const layer of dataset.layers) {
          const srs = await detectSrs(layer)
          const reprojectFn = new gdal.CoordinateTransformation(srs, wgs84)

          for await (const feature of layer.features) {
            const names = feature.fields.getNames()
            const geometry = feature.getGeometry()
            if (!geometry) {
              throw new InvalidRequestApiError('Le fichier Telepac contient une parcelle sans géométrie.')
            }
            await geometry.transformAsync(reprojectFn)
            const id = names.includes('id') ? feature.fields.get('id') : getRandomFeatureId()
            const properties = telepacPropertiesSchema.safeParse(feature.fields.toObject())

            if (!properties.success) {
              throw new InvalidRequestApiError(
                'Il ne s\'agit pas d\'un fichier Telepac "Parcelles déclarées" ou "Parcelles instruites".',
                { cause: properties.error }
              )
            }

            const { AGRIBIO, CAMPAGNE, CODE_VAR, COMMUNE, NUMERO_I, NUMERO_P, PACAGE, TYPE } = properties.data

            featureCollection.features.push({
              type: 'Feature',
              id,
              geometry: geometry.toObject(),
              properties: {
                id,
                BIO: AGRIBIO,
                CAMPAGNE,
                COMMUNE,
                cultures: [
                  {
                    id: randomUUID(),
                    CPF: fromCodePacStrict(TYPE, CODE_VAR ?? undefined)?.code_cpf,
                    TYPE
                  }
                ],
                conversion_niveau: AGRIBIO === 1 ? EtatProduction.BIO : EtatProduction.NB,
                NUMERO_I,
                NUMERO_P,
                PACAGE,
                ...(TYPE ? { TYPE } : {}),
                ...(CODE_VAR ? { CODE_VAR } : {})
              }
            })
          }
        }
      } finally {
        await dataset.close()
      }
    }
  } finally {
    await cleanup()
  }

  return featureCollection
}

function toGeoJSONCoordinates(gmlCoordinates: string): import('geojson').Position[] {
  return (
    gmlCoordinates
      .trim()
      .replace(/\n/g, '')
      .split(' ')
      // clean tabular spacing
      .filter(removeEmptyElements)
      // we split the single unit of X,Y into array pairs of [X, Y]
      .map((unit) => unit.split(','))
      // turn them into floats
      .map(([X = '', Y = '']) => [parseFloat(X), parseFloat(Y)])
  )
}

/**
 * @see https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6
 */
function gmlGeometryToGeoJSONGeometry(gmlPolygon: GmlPolygon): import('geojson').Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      // exterior ring
      toGeoJSONCoordinates(gmlPolygon['gml:outerBoundaryIs']['gml:LinearRing']['gml:coordinates']),
      // optional interior rings
      ...(gmlPolygon['gml:innerBoundaryIs'] ?? []).map((boundary) => {
        return toGeoJSONCoordinates(boundary['gml:LinearRing']['gml:coordinates'])
      })
    ].filter(removeEmptyElements)
  }
}

/**
 * Parse a Telepac/MesParcelles XML export to GeoJSON
 * For now, it works only with Metropole projection
 */
async function fromXMLFile(xmlContent: string): Promise<FeatureCollection> {
  const parsed = telepacXmlSchema.safeParse(
    new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      isArray: (name, _jpath, isLeafNode, isAttribute) =>
        ['ilot', 'parcelle', 'gml:innerBoundaryIs'].includes(name) && !isAttribute && !isLeafNode
    }).parse(xmlContent)
  )
  if (!parsed.success)
    throw new InvalidRequestApiError('Le fichier Telepac XML est invalide.', {
      cause: parsed.error
    })

  const { producteur } = parsed.data.producteurs
  const PACAGE = producteur['@_numero-pacage']
  const ilots = producteur.rpg.ilot ?? producteur.rpg.ilots?.ilot ?? []

  const geojson = featureCollection(
    ilots.flatMap((ilot) => {
      const { '@_numero-ilot': NUMERO_I, commune: COMMUNE } = ilot

      return ilot.parcelles.parcelle.map((parcelle) => {
        const id = getRandomFeatureId()
        const props = parcelle['descriptif-parcelle']
        const { '@_numero-parcelle': NUMERO_P } = props
        const { '@_conduite-bio': AGRIBIO } = props['agri-bio'] ?? {}
        const TYPE = props['culture-principale']['code-culture']
        const CODE_VAR = props['culture-principale'].precision

        return Feature(
          gmlGeometryToGeoJSONGeometry(parcelle.geometrie['gml:Polygon']),
          {
            id,
            remoteId: `${NUMERO_I}.${NUMERO_P}`,
            COMMUNE,
            cultures: [
              {
                id: randomUUID(),
                CPF: fromCodePacStrict(TYPE, CODE_VAR)?.code_cpf,
                TYPE
              }
            ],
            NUMERO_I,
            NUMERO_P,
            PACAGE,
            conversion_niveau: AGRIBIO === 'true' ? EtatProduction.BIO : EtatProduction.NB,
            TYPE,
            CODE_VAR
          },
          { id }
        )
      })
    })
  )

  return toWgs84(geojson, LegalProjections.metropole)
}

export { parseTelepacArchive }
