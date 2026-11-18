import { departementsResponseSchema } from '@agencebio/cartobio-types'
import { commonErrorResponses, protectedWithToken, TAGS, withSchema } from '../../shared/routes.js'

export const departementsSchema = withSchema(protectedWithToken(), {
  operationId: 'listDepartements',
  tags: [TAGS.REFERENTIELS],
  summary: 'Liste des départements',
  response: { ...commonErrorResponses, 200: departementsResponseSchema }
})
