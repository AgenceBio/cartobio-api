'use strict'

const sandboxSchema = {
  schema: {
    tags: ['Bac à sable']
  }
}

const deprecatedSchema = {
  schema: {
    deprecated: true
  }
}

const ocSchema = {
  schema: {
    tags: ['Organisme de certification']
  }
}

const internalSchema = {
  schema: {
    tags: ['CartoBio']
  }
}

const hiddenSchema = {
  schema: {
    tags: ['X-HIDDEN']
  }
}

const routeWithNumeroBio = {
  schema: {
    params: {
      numeroBio: { type: 'integer' }
    }
  }
}

const routeWithRecordId = {
  schema: {
    params: {
      recordId: { type: 'string', format: 'uuid' }
    }
  }
}

const routeWithOperatorId = {
  schema: {
    params: {
      operatorId: { type: 'string', pattern: '^\\d+$' }
    }
  }
}

const routeWithPacage = {
  schema: {
    params: {
      numeroPacage: {
        type: 'string',
        pattern: '^\\d{9}$'
      }
    }
  }
}

module.exports = {
  sandboxSchema,
  ocSchema,
  internalSchema,
  deprecatedSchema,
  hiddenSchema,

  routeWithNumeroBio,
  routeWithOperatorId,
  routeWithPacage,
  routeWithRecordId
}
