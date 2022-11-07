'use strict'

const sandboxSchema = {
  schema: {
    tags: ['Bac à sable']
  }
}

const ocSchema = {
  schema: {
    tags: ['Organisme de certification']
  }
}

const internalSchema = {
  schema: {
    // tags: ['cartobio.org']
  }
}

const routeWithNumeroBio = {
  schema: {
    params: {
      numeroBio: { type: 'integer' }
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

  routeWithNumeroBio,
  routeWithPacage
}
