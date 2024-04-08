import fastify from 'fastify'

import { CartoBioOCUser } from './lib/providers/types/cartobio'
import { OrganismeCertificateur } from './lib/providers/types/agence-bio'
import { AgenceBioNormalizedOperator } from './lib/outputs/types/operator'
import { NormalizedRecord } from './lib/outputs/types/record'

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
