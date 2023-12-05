const postCertificationParcellesSchema = {
  schema: {
    body: {
      type: 'array',
      items: {
        $ref: '#/definitions/parcellaire'
      },

      definitions: {
        parcellaire: {
          type: 'object',
          required: ['numeroBio'],
          properties: {
            numeroBio: {
              type: 'string'
            },
            numeroClient: {
              type: 'string'
            },
            anneeReferenceControle: {
              type: 'string'
            },
            anneeAssolement: {
              type: 'string'
            },
            dateAudit: {
              type: 'string',
              format: 'date'
            },
            numeroPacage: {
              type: 'string'
            },
            parcelles: {
              type: 'array',
              items: {
                $ref: '#/definitions/feature'
              }
            }
          }
        },

        feature: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string'
            },
            dateEngagement: {
              type: 'string',
              format: 'date'
            },
            etatProduction: {
              type: 'string'
            },
            numeroIlot: {
              type: 'string'
            },
            numeroParcelle: {
              type: 'string'
            },
            commentaire: {
              type: 'string'
            },
            geom: {
              type: 'string'
            },
            culture: {
              type: 'array',
              items: {
                type: 'object',
                required: ['codeCPF'],
                properties: {
                  codeCPF: {
                    type: 'string'
                  },
                  variete: {
                    type: 'string'
                  },
                  quantite: {
                    type: 'string'
                  },
                  unite: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      }
    },

    response: {
      202: {
        type: 'object',
        properties: {
          nbObjetTraites: {
            type: 'number'
          }
        }
      },
      400: {
        type: 'object',
        properties: {
          nbObjetTraites: {
            type: 'number'
          },
          nbObjetAcceptes: {
            type: 'number'
          },
          nbObjetRefuses: {
            type: 'number'
          },
          listeProblemes: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        }
      }
    }
  }
}

const respondWithFeatureCollectionSchema = {
  schema: {
    response: {
      200: {
        $ref: 'cartobio#featureCollection'
      }
    }
  }
}

module.exports = {
  postCertificationParcellesSchema,
  respondWithFeatureCollectionSchema
}
