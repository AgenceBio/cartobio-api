import type { CartoBioOCUser, OrganismeCertificateur, AgenceBioNormalizedOperator, NormalizedRecord } from '@agencebio/cartobio-types'
import type { OAuth2Namespace } from '@fastify/oauth2'

declare module 'fastify' {
  interface FastifyInstance {
    agenceBioOAuth2: OAuth2Namespace;
    geofoliaOAuth2: OAuth2Namespace;
  }

  interface FastifyRequest {
    user: CartoBioOCUser | null;
    organismeCertificateur: OrganismeCertificateur | null;
    operator: AgenceBioNormalizedOperator | null;
    record: NormalizedRecord | null;
  }
}
