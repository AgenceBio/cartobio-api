'use strict'

const {
  mergeSchemas,
  protectedWithToken,
  operatorFromNumeroBio,
  operatorsSchema,
  certificationBodySearchSchema,
  dashboardSummarySchema,
  autocompleteSchema
} = require('./operators.schema.js')
const service = require('./operators.service.js')

module.exports = async function operatorRoutes (app) {
  app.post(
    '/api/v2/certification/search',
    mergeSchemas(certificationBodySearchSchema, protectedWithToken()),
    async (request, reply) => {
      const { input, page, limit, filter } = request.body
      const { id: ocId } = request.user.organismeCertificateur

      return reply.code(200).send(
        service.searchControlBodyRecords({
          ocId,
          userId: request.user.id,
          input,
          page,
          limit,
          filter
        })
      )
    }
  )

  /**
   * @private
   */
  app.post('/api/v2/certification/adminsearch', mergeSchemas(certificationBodySearchSchema, protectedWithToken({ admin: true })), async (request, reply) => {
    const { input, page, limit, filter } = request.body
    return reply.code(200).send(service.searchControlBodyRecordsAdmin({ input, page, limit, filter }))
  })

  /**
   * @private
   */
  app.get('/api/v2/certification/autocomplete', mergeSchemas(autocompleteSchema, protectedWithToken()), async (request, reply) => {
    const { search } = request.query
    const { id: userId, organismeCertificateur } = request.user

    return reply
      .code(200)
      .send(
        service.searchForAutocomplete(organismeCertificateur?.id, userId, search)
      )
  }
  )

  /**
   * @private
   * Retrieve operators for a given user
   */
  app.get(
    '/api/v2/operators',
    mergeSchemas(protectedWithToken({ cartobio: true }), operatorsSchema),
    async (request, reply) => {
      const { id: userId } = request.user
      const { search, limit, offset } = request.query

      return Promise.all([
        service.fetchUserOperators(userId),
        service.getPinnedOperators(request.user.id)
      ]
      ).then(([res, pinnedOperators]) => {
        const filteredOperators = res.operators
          .filter((e) => {
            if (!search) return true

            const userInput = search.toLowerCase().trim()

            return e.denominationCourante.toLowerCase().includes(userInput) ||
          e.numeroBio.toString().includes(userInput) ||
          e.nom.toLowerCase().includes(userInput) ||
          e.siret.toLowerCase().includes(userInput)
          })

        const sortedOperators = filteredOperators
          .toSorted(service.recordSorts('fn', 'notifications', 'desc'))

        const paginatedOperators = sortedOperators
          .slice(offset, offset + limit)
          .map((o) => ({
            ...o,
            epingle: pinnedOperators.includes(+o.numeroBio)
          }))

        return reply.code(200).send({
          nbTotal: filteredOperators.length,
          operators: paginatedOperators
        })
      })
    })

  /**
   * @private
   * Retrieve operators for a given user for their dashboard
   */
  app.get(
    '/api/v2/operators/dashboard',
    mergeSchemas(protectedWithToken({ oc: true, cartobio: true })),
    async (request, reply) => {
      const { id: userId } = request.user
      const { id: ocId } = request.user.organismeCertificateur

      return Promise.all([
        service.getPinnedOperators(userId),
        service.getConsultedOperators(userId)
      ]).then(async ([pinnedNumerobios, consultedNumerobio]) => {
        const uniqueNumerobios = [
          ...new Set([...pinnedNumerobios, ...consultedNumerobio])
        ]
        const operators = (await service.fetchCustomersByOc(ocId)).filter(
          (operator) =>
            uniqueNumerobios.includes(operator.numeroBio) &&
            operator.notifications.certification_state !== 'ARRETEE' &&
            operator.notifications.organismeCertificateurId === ocId &&
            ['ENGAGEE', 'ENGAGEE FUTUR'].includes(
              operator.notifications.etatCertification
            )
        )
        return Promise.all(operators.map((o) => service.addRecordData(o))).then(
          (operatorsWithData) =>
            reply.code(200).send({
              pinnedOperators: pinnedNumerobios
                .filter((numeroBio) =>
                  operatorsWithData.find((o) => o.numeroBio === numeroBio)
                )
                .map((numeroBio) => ({
                  ...operatorsWithData.find((o) => o.numeroBio === numeroBio),
                  epingle: true
                })),
              consultedOperators: consultedNumerobio
                .filter((numeroBio) =>
                  operatorsWithData.find((o) => o.numeroBio === numeroBio)
                )
                .map((numeroBio) => ({
                  ...operatorsWithData.find((o) => o.numeroBio === numeroBio),
                  epingle: pinnedNumerobios.includes(numeroBio)
                }))
            })
        )
      })
    }
  )

  /**
   * @private
   * Retrieve operators for a given user for their dashboard
   */
  app.post(
    '/api/v2/operators/dashboard-summary',
    mergeSchemas(
      dashboardSummarySchema,
      protectedWithToken({ oc: true, cartobio: true })
    ),
    async (request, reply) => {
      const { departements, anneeReferenceControle } = request.body
      const { id: ocId } = request.user.organismeCertificateur

      return reply
        .code(200)
        .send(service.getDashboardSummary(ocId, departements, anneeReferenceControle))
    }
  )

  /**
   * @private
   * Retrieve an operator
   */
  app.get(
    '/api/v2/operator/:numeroBio',
    mergeSchemas(protectedWithToken(), operatorFromNumeroBio),
    async (request, reply) => {
      const pinnedOperators = await service.getPinnedOperators(request.user.id)

      request.operator.epingle = pinnedOperators.includes(
        +request.operator.numeroBio
      )

      return reply.code(200).send(request.operator)
    }
  )

  /**
   * @private
   * Pin an operator
   */
  app.post(
    '/api/v2/operator/:numeroBio/pin',
    mergeSchemas(protectedWithToken()),
    async (request, reply) => {
      await service.pinOperator(request.params.numeroBio, request.user.id)

      return reply.code(200).send({ epingle: true })
    }
  )

  /**
   * @private
   * Unpin an operator
   */
  app.post(
    '/api/v2/operator/:numeroBio/unpin',
    mergeSchemas(protectedWithToken()),
    async (request, reply) => {
      await service.unpinOperator(request.params.numeroBio, request.user.id)

      return reply.code(200).send({ epingle: false })
    }
  )

  /**
   * @private
   * Mark an operator as consulted
   */
  app.post(
    '/api/v2/operator/:numeroBio/consulte',
    mergeSchemas(protectedWithToken()),
    async (request, reply) => {
      await service.consultOperator(request.params.numeroBio, request.user.id)

      return reply.code(204).send()
    }
  )

  /**
  /**
   * @private
   * Retrieve an operator records
   */
  app.get(
    '/api/v2/operator/:numeroBio/records',
    mergeSchemas(protectedWithToken(), operatorFromNumeroBio),
    async (request, reply) => {
      const records = await service.getRecords(request.params.numeroBio)

      if (
        !request.user.organismeCertificateur ||
        request.user.organismeCertificateur.id ===
          request.operator.organismeCertificateur.id
      ) {
        return reply.code(200).send(records)
      }

      return reply
        .code(200)
        .send(
          records.filter(
            (r) => r.oc_id === request.user.organismeCertificateur.id
          )
        )
    }
  )

  /**
   * @private
   * Checks if operator can import a pac record from 2025
   */
  app.get(
    '/api/v2/operator/:numeroBio/importData',
    mergeSchemas(protectedWithToken(), operatorFromNumeroBio),
    async (request, reply) => {
      const res = await service.getImportPAC(request.params.numeroBio)
      return reply.code(200).send({ data: res })
    }
  )

  /**
   * @private
   * Hide import PAC 2025 notif
   */
  app.patch(
    '/api/v2/operator/:numeroBio/hideNotif',
    mergeSchemas(protectedWithToken()),
    async (request, reply) => {
      await service.hideImport(request.params.numeroBio)
      return reply.code(204).send()
    }
  )

}
