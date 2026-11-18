import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  autocompleteSchema,
  certificationAdminSearchSchema,
  certificationSearchSchema,
  consultOperatorSchema,
  dashboardSchema,
  dashboardSummarySchema,
  getOperatorSchema,
  hideImportPacNotificationSchema,
  operatorImportPacSchema,
  operatorRecordsSchema,
  pinOperatorSchema,
  unpinOperatorSchema,
  userOperatorsSchema
} from './operators.schema.js'
import * as service from './operators.service.js'
import { requireOcUser, requireOperator, requireUser } from '../../shared/request.js'
import type { AgenceBioNormalizedOperatorWithPinnedStatus } from '@agencebio/cartobio-types'

export default async function operatorRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.post('/api/v2/certification/search', certificationSearchSchema, async (request, reply) => {
    const { input, page, limit, filter } = request.body
    const user = requireOcUser(request)

    return reply.code(200).send(
      await service.searchControlBodyRecords({
        ocId: user.organismeCertificateur.id,
        userId: user.id,
        input,
        page,
        limit,
        filter
      })
    )
  })

  app.post('/api/v2/certification/adminsearch', certificationAdminSearchSchema, async (request, reply) => {
    const { input, page, limit, filter } = request.body
    return reply.code(200).send(await service.searchControlBodyRecordsAdmin({ input, page, limit, filter }))
  })

  app.get('/api/v2/certification/autocomplete', autocompleteSchema, async (request, reply) => {
    const { search } = request.query
    const { id: userId, organismeCertificateur } = requireUser(request)

    return reply.code(200).send(await service.searchForAutocomplete(organismeCertificateur?.id, userId, search))
  })

  app.get('/api/v2/operators', userOperatorsSchema, async (request, reply) => {
    const { search, limit, offset } = request.query

    return reply.code(200).send(await service.listUserOperators(requireUser(request).id, { search, limit, offset }))
  })

  app.get('/api/v2/operators/dashboard', dashboardSchema, async (request, reply) => {
    const user = requireOcUser(request)

    return reply.code(200).send(await service.getOperatorsDashboard(user.id, user.organismeCertificateur.id))
  })

  app.post('/api/v2/operators/dashboard-summary', dashboardSummarySchema, async (request, reply) => {
    const { departements, anneeReferenceControle } = request.body
    const { id: ocId } = requireOcUser(request).organismeCertificateur

    return reply.code(200).send(await service.getDashboardSummary(ocId, departements, anneeReferenceControle))
  })

  app.get('/api/v2/operator/:numeroBio', getOperatorSchema, async (request, reply) => {
    const pinnedOperators = await service.getPinnedOperators(requireUser(request).id)

    const operator = requireOperator(request) as AgenceBioNormalizedOperatorWithPinnedStatus
    operator.epingle = pinnedOperators.includes(+operator.numeroBio)

    return reply.code(200).send(operator)
  })

  app.post('/api/v2/operator/:numeroBio/pin', pinOperatorSchema, async (request, reply) => {
    await service.pinOperator(request.params.numeroBio, requireUser(request).id)

    return reply.code(200).send({ epingle: true })
  })

  app.post('/api/v2/operator/:numeroBio/unpin', unpinOperatorSchema, async (request, reply) => {
    await service.unpinOperator(request.params.numeroBio, requireUser(request).id)

    return reply.code(200).send({ epingle: false })
  })

  app.post('/api/v2/operator/:numeroBio/consulte', consultOperatorSchema, async (request, reply) => {
    await service.consultOperator(request.params.numeroBio, requireUser(request).id)

    return reply.code(204).send()
  })

  app.get('/api/v2/operator/:numeroBio/records', operatorRecordsSchema, async (request, reply) => {
    const records = await service.getOperatorRecordsForUser(
      request.params.numeroBio,
      requireUser(request),
      requireOperator(request)
    )

    return reply.code(200).send(records)
  })

  app.get('/api/v2/operator/:numeroBio/importData', operatorImportPacSchema, async (request, reply) => {
    const res = await service.getImportPAC(request.params.numeroBio)
    return reply.code(200).send({ data: res })
  })

  app.patch('/api/v2/operator/:numeroBio/hideNotif', hideImportPacNotificationSchema, async (request, reply) => {
    await service.hideImport(request.params.numeroBio)
    return reply.code(204).send()
  })
}
