import gotModule from 'got'
import { XMLParser } from 'fast-xml-parser'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { feature, featureCollection } from '@turf/helpers'
import { fromCepageCode } from '@agencebio/rosetta-cultures/cepages'
import config from '../../../config/env.js'
import { BadGatewayApiError } from '../../../shared/errors.js'
import { getRandomFeatureId } from '../../../shared/outputs/features.js'
import type { FeatureCollection } from 'geojson'
import { z } from 'zod'
import { parseApiResponse } from '../../../clients/clients.utils.js'

const { extend, HTTPError } = gotModule.default

const evvSpcvSchema = z.looseObject({
  etatGestion: z.string(),
  codeCepage: z.string(),
  superficieSPCV: z.string().optional()
})

const evvPcvSchema = z.looseObject({
  codeDepartement: z.string(),
  codeInseeCommune: z.string(),
  prefixe: z.string().optional(),
  section: z.string(),
  plan: z.string(),
  listeSpcv: z.union([z.looseObject({ spcv: z.array(evvSpcvSchema).optional() }), z.string()])
})

const evvLookupSchema = z.looseObject({
  evv: z.looseObject({
    numero: z.string(),
    siret: z.string().optional(),
    libelle: z.string().optional()
  })
})

const evvParcellaireSchema = z.looseObject({
  parcellaire: z.looseObject({
    listePcv: z.union([z.looseObject({ pcv: z.array(evvPcvSchema).optional() }), z.string()])
  })
})

const evvClient = extend({
  http2: false,
  https: { rejectUnauthorized: false },
  timeout: { lookup: 200, connect: 500 },
  ...(config.get('douanes.socksProxy') ? {
    agent: {
      http: new SocksProxyAgent(config.get('douanes.socksProxy')),
      https: new SocksProxyAgent(config.get('douanes.socksProxy'))
    }
  } : {}),
  prefixUrl: config.get('douanes.baseUrl')
})

async function evvLookup ({ numeroEvv }: { numeroEvv: string }): Promise<{ numero: string; siret: string | undefined; libelle: string }> {
  try {
    const response = await evvClient.get(`evv/${numeroEvv}`).text()
    const { numero, siret, libelle } = parseApiResponse(evvLookupSchema, new XMLParser({ parseTagValue: false }).parse(response), 'l\'API CVI').evv
    return { numero, siret, libelle: libelle ?? '' }
  } catch (error) {
    if (error instanceof HTTPError && (error?.response?.statusCode === 404 || !Object.hasOwn(error, 'code'))) {
      return { siret: undefined, numero: numeroEvv, libelle: '' }
    }
    throw new BadGatewayApiError("Impossible de communiquer avec l'API CVI.", { cause: error })
  }
}

async function evvParcellaire ({ numeroEvv }: { numeroEvv: string }): Promise<FeatureCollection> {
  const response = await evvClient.get(`parcellaire/${numeroEvv}`).text()
  const { listePcv } = parseApiResponse(evvParcellaireSchema, new XMLParser({
    parseTagValue: false,
    isArray: (name, _jpath, isLeafNode, isAttribute) => ['pcv', 'spcv'].includes(name) && !isAttribute && !isLeafNode
  }).parse(response), 'l\'API CVI').parcellaire
  if (typeof listePcv === 'string' || !listePcv.pcv) return featureCollection([])

  return featureCollection(listePcv.pcv.map(p => {
    const id = getRandomFeatureId()
    return feature(null, {
      id,
      cadastre: [`${p.codeDepartement}${p.codeInseeCommune}${p.prefixe || '000'}${p.section.padStart(2, '0')}${p.plan.padStart(4, '0')}`],
      cultures: (typeof p.listeSpcv === 'string' ? [] : p.listeSpcv.spcv ?? [])
        .filter(({ etatGestion }) => etatGestion === 'PL')
        .map(sp => ({
          CPF: fromCepageCode(sp.codeCepage)?.code_cpf ?? '01.21.1',
          variete: fromCepageCode(sp.codeCepage)?.libelle,
          surface: parseFloat(sp.superficieSPCV ?? '0')
        }))
    }, { id })
  }))
}

export { evvClient, evvLookup, evvParcellaire }
