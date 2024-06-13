const { mergeSchemas } = require('./index')
const TJS = require('typescript-json-schema')

const generator = TJS.buildGenerator(TJS.getProgramFromFiles(['./lib/types.d.ts']), {
  ref: false
})

const collectionSchema = generator.getSchemaForSymbol('CartoBioFeatureCollection')
const featureSchema = generator.getSchemaForSymbol('CartoBioFeature')

const recordInfosSchema = {
  schema: {
    body: {
      type: 'object',
      properties: {
        audit_date: {
          type: ['string', 'null'],
          format: 'date'
        },
        audit_notes: {
          type: 'string'
        },
        audit_demandes: {
          type: 'string'
        },
        certification_date_debut: {
          type: ['string', 'null'],
          format: 'date'
        },
        certification_date_fin: {
          type: ['string', 'null'],
          format: 'date'
        }
      }
    }
  }
}

const createRecordSchema = mergeSchemas({
  schema: {
    body: {
      type: 'object',
      required: ['parcelles'],
      properties: {
        parcelles: collectionSchema,
        metadata: {
          type: 'object'
        },
        version_name: {
          type: 'string'
        },
        importPrevious: {
          type: 'boolean'
        }
      }
    }
  }
}, recordInfosSchema)

const deleteSingleFeatureSchema = {
  schema: {
    body: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'object',
          required: ['code'],
          properties: {
            code: {
              type: 'string',
              // content duplicated from the frontend
              enum: ['lifecycle', 'other', 'error']
            },
            reason: {
              type: 'string'
            }
          }
        }
      }
    }
  }
}

const patchFeatureCollectionSchema = {
  schema: {
    body: generator.getSchemaForSymbol('CartoBioFeatureCollection')
  }
}

const createFeatureSchema = {
  schema: {
    body: {
      type: 'object',
      required: ['feature'],
      properties: {
        feature: generator.getSchemaForSymbol('CartoBioFeature')
      }
    }
  }
}

const updateFeaturePropertiesSchema = {
  schema: {
    body: featureSchema
  }
}

module.exports = {
  createFeatureSchema,
  createRecordSchema,
  deleteSingleFeatureSchema,
  patchFeatureCollectionSchema,
  patchRecordSchema: recordInfosSchema,
  updateFeaturePropertiesSchema
}
