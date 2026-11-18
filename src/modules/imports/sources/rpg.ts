import { randomUUID } from 'node:crypto'
import reproject from 'reproject'
import { fromCodePacStrict } from '@agencebio/rosetta-cultures'
import { EtatProduction } from '@agencebio/cartobio-types'
import * as repository from '../imports.repository.js'

const { toWgs84 } = reproject

async function pacageLookup ({ numeroPacage }: { numeroPacage: string }) {
  const rows = await repository.findPacageParcelles(numeroPacage)

  return toWgs84({
    type: 'FeatureCollection',
    features: rows.map(({ geometry, fid: id, NUMERO_I, NUMERO_P, TYPE, BIO, CODE_VAR }) => ({
      type: 'Feature', id, remoteId: id, geometry,
      properties: {
        id, BIO,
        cultures: [{ id: randomUUID(), CPF: fromCodePacStrict(TYPE, CODE_VAR)?.code_cpf, TYPE }],
        NUMERO_I, NUMERO_P, PACAGE: numeroPacage,
        conversion_niveau: BIO === 1 ? EtatProduction.BIO : EtatProduction.NB
      }
    }))
  }, 'EPSG:3857')
}

export { pacageLookup }
