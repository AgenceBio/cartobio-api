import gotModule from 'got'
import { XMLParser } from 'fast-xml-parser'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { feature, featureCollection } from '@turf/helpers'
import { fromCepageCode } from '@agencebio/rosetta-cultures/cepages'
import config from '../../../config/env.js'
import { BadGatewayApiError } from '../../../shared/errors.js'
import { getRandomFeatureId } from '../../../shared/outputs/features.js'

const { extend, HTTPError } = gotModule.default

interface EvvSpcv {
  etatGestion: string
  codeCepage: string
  superficieSPCV?: string
}
interface EvvPcv {
  codeDepartement: string
  codeInseeCommune: string
  prefixe?: string
  section: string
  plan: string
  listeSpcv: { spcv?: EvvSpcv[] }
}

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

async function evvLookup ({ numeroEvv }: { numeroEvv: string }) {
  try {
    const response = await evvClient.get(`evv/${numeroEvv}`).text()
    const { numero, siret, libelle } = new XMLParser({ parseTagValue: false }).parse(response).evv
    return { numero, siret, libelle }
  } catch (error) {
    if (error instanceof HTTPError && (error?.response?.statusCode === 404 || !Object.hasOwn(error, 'code'))) {
      return { siret: undefined, numero: numeroEvv, libelle: '' }
    }
    throw new BadGatewayApiError("Impossible de communiquer avec l'API CVI.", { cause: error })
  }
}

async function evvParcellaire ({ numeroEvv }: { numeroEvv: string }) {
  const response = await evvClient.get(`parcellaire/${numeroEvv}`).text()
  const xml = new XMLParser({
    parseTagValue: false,
    isArray: (name, jpath, isLeafNode, isAttribute) => ['pcv', 'spcv'].includes(name) && !isAttribute && !isLeafNode
  }).parse(response)
  if (!Array.isArray(xml.parcellaire.listePcv.pcv)) return featureCollection([])

  return featureCollection((xml.parcellaire.listePcv.pcv as EvvPcv[]).map(p => {
    const id = getRandomFeatureId()
    return feature(null, {
      id,
      cadastre: [`${p.codeDepartement}${p.codeInseeCommune}${p.prefixe || '000'}${p.section.padStart(2, '0')}${p.plan.padStart(4, '0')}`],
      cultures: (Array.isArray(p.listeSpcv.spcv) ? p.listeSpcv.spcv : [])
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
