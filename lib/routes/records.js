const { EtatProduction } = require('../providers/agence-bio.js')

const createRecordSchema = {
  schema: {
    body: {
      type: 'object',
      required: ['geojson', 'ocId', 'ocLabel', 'numeroBio'],
      properties: {
        geojson: {
          $ref: 'cartobio#featureCollection'
        },
        ocId: {
          type: 'number',
          exclusiveMinimum: 0
        },
        ocLabel: {
          type: 'string'
        },
        numeroBio: {
          $ref: 'cartobio#numerobio'
        }
      }
    }
  }
}

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
    body: {
      $ref: 'cartobio#featureCollection#'
    }
  }
}

const createFeatureSchema = {
  schema: {
    body: {
      type: 'object',
      required: ['feature'],
      properties: {
        feature: {
          $ref: 'cartobio#feature#'
        }
      }
    }
  }
}

const updateFeaturePropertiesSchema = {
  schema: {
    body: {
      $ref: 'cartobio#featureCollection#'
    }
  }
}

const patchRecordSchema = {
  schema: {
    body: {
      /*
       * AUDIT
       */
      auditeur_notes: {
        type: 'string'
      },
      /* TODO hm, sounds vaguely too similar to the one above */
      audit_notes: {
        type: 'string'
      },
      audit_demandes: {
        type: 'string'
      },
      certification_date_debut: {
        type: 'string',
        format: 'date'
      },
      certification_date_fin: {
        type: 'string',
        format: 'date'
      },
      cultures: {
        type: 'array',
        minItems: 1,
        items: {
          $ref: 'cartobio#feature-culture'
        }
      },
      /*
       * Parcelles
       */
      conversion_niveau: {
        type: 'string',
        // We ensure duplicate values of EtatProduction are filtered out
        enum: Array.from(new Set([...Object.values(EtatProduction), 'AB?']))
      },
      engagement_date: {
        type: 'string',
        format: 'date'
      }
    }
  }
}

module.exports = {
  createFeatureSchema,
  createRecordSchema,
  deleteSingleFeatureSchema,
  patchFeatureCollectionSchema,
  patchRecordSchema,
  updateFeaturePropertiesSchema
}
