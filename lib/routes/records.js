const { EtatProduction } = require('../providers/agence-bio.js')

const updateRecordSchema = {
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

/**
 * Might be used when we PATCH updates rather than posting the entire FeatureCollection
 * Why? Because sending PATCH will help track the update types within AuditHistoryEvent objects
 */
const updateFeatureSchema = {
  schema: {
    body: {
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
      conversion_niveau: {
        type: 'string',
        // We ensure duplicate values of EtatProduction are filtered out
        enum: Array.from(new Set([...Object.values(EtatProduction), 'AB?']))
      },
      engagement_date: {
        type: 'string',
        format: 'date'
      },
      cultures: {
        type: 'array',
        minItems: 1,
        items: {
          $ref: 'cartobio#feature-culture'
        }
      }
    }
  }
}

module.exports = {
  updateRecordSchema,
  updateFeatureSchema
}
