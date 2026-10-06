import { CartoBioOCUser } from '../shared/types/cartobio'
import { OrganismeCertificateur } from '../clients/types/agence-bio'
import { AgenceBioNormalizedOperator } from '../shared/outputs/types/operator'
import { NormalizedRecord } from '../shared/outputs/types/record'
import * as geojson from 'geojson'

declare module 'fastify' {
  interface FastifyRequest {
    user: CartoBioOCUser | null;
    organismeCertificateur: OrganismeCertificateur | null;
    operator: AgenceBioNormalizedOperator | null;
    record: NormalizedRecord | null;
  }

  interface Querystring {
    access_token: string | null;
  }
}

declare module 'gdal-async' {
  interface Geometry {
    toObject(): geojson.Polygon | geojson.MultiPolygon;
  }
}
