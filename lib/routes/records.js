const { EtatProduction } = require('../providers/agence-bio.js')

const patchRecordSchema = {
  schema: {
    body: {
      type: 'object',
      required: ['geojson', 'ocId', 'ocLabel', 'numeroBio'],
      properties: {
        geojson: {
          $ref: 'cartobio#geojson'
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

const patchFeatureCollectionSchema = {
  schema: {
    body: {
      $ref: 'cartobio#geojson#'
    }
  }
}

const updateFeaturePropertiesSchema = {
  schema: {
    body: {
      $ref: 'cartobio#geojson-feature#'
    }
  }
}

const updateRecordSchema = {
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
  patchFeatureCollectionSchema,
  patchRecordSchema,
  updateFeaturePropertiesSchema,
  updateRecordSchema
}
