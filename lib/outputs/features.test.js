const { deepMergeObjects } = require('./features.js')

describe('deepMergeObjects()', () => {
  test('matching properties should be merged (eg: mass action on a collection)', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        {
          id: 1234,
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
          properties: {
            comment: 'coucou',
            certification_state: 'DRAFT'
          }
        },
        {
          id: 5678,
          properties: {
            certification_state: 'DRAFT'
          }
        }
      ]
    }

    const patch = [
      {
        id: 1234,
        properties: {
          certification_state: 'CERTIFIED'
        }
      },
      {
        id: 91011,
        geometry: { type: 'Polygon', coordinates: [[[1, 1], [89, 89]]] },
        properties: {
          certification_state: 'AUDITED'
        }
      }
    ]

    const expectation = [
      {
        id: 1234,
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
        properties: {
          comment: 'coucou',
          certification_state: 'CERTIFIED'
        }
      },
      {
        id: 5678,
        properties: {
          certification_state: 'DRAFT'
        }
      },
      {
        id: 91011,
        geometry: { type: 'Polygon', coordinates: [[[1, 1], [89, 89]]] },
        properties: {
          certification_state: 'AUDITED'
        }
      }
    ]

    expect(deepMergeObjects(collection.features, patch)).toEqual(expectation)
  })

  test('drop missing ids (eg: when a culture is removed)', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        {
          id: 1234,
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
          properties: {
            comment: 'coucou',
            certification_state: 'DRAFT',
            cultures: [
              // will be updated
              {
                id: 'abcd-uuid',
                CPF: '1.13.41.1',
                date_semis: '2023-01-01'
              }
            ]
          }
        },
        {
          id: 5678,
          geometry: { type: 'Polygon', coordinates: [[[1, 1], [89, 89]]] },
          properties: {
            certification_state: 'DRAFT',
            cultures: [
              // will be removed
              {
                id: 'efgh-uuid',
                CPF: '01.92',
                comment: 'should be removed'
              },
              // will be updated
              {
                id: 'ijkl-uuid',
                CPF: '01.21.12',
                variete: 'Chardonnay'
              }
            ]
          }
        }
      ]
    }

    const patch = [
      {
        id: 1234,
        properties: {
          certification_state: 'CERTIFIED',
          cultures: [
            {
              id: 'abcd-uuid',
              // will be added
              variete: 'Chantenay'
            }
          ]
        }
      },
      {
        id: 5678,
        geometry: { type: 'Polygon', coordinates: [[[2, 2], [89, 89]]] },
        properties: {
          cultures: [
            {
              id: 'ijkl-uuid',
              // will be updated
              variete: 'Clairette'
            },
            // will be added
            {
              id: 'mnop-uuid',
              CPF: '01.26.1'
            }
          ]
        }
      }
    ]

    const expectation = [
      {
        id: 1234,
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
        properties: {
          comment: 'coucou',
          certification_state: 'CERTIFIED',
          cultures: [
            {
              id: 'abcd-uuid',
              CPF: '1.13.41.1',
              variete: 'Chantenay',
              date_semis: '2023-01-01'
            }
          ]
        }
      },
      {
        id: 5678,
        geometry: { type: 'Polygon', coordinates: [[[2, 2], [89, 89]]] },
        properties: {
          certification_state: 'DRAFT',
          cultures: [
            {
              id: 'ijkl-uuid',
              CPF: '01.21.12',
              variete: 'Clairette'
            },
            {
              id: 'mnop-uuid',
              CPF: '01.26.1'
            }
          ]
        }
      }
    ]

    const mergedWithDrop = deepMergeObjects(collection.features, patch, deepMergeObjects.DROP_MISSING_IDS)
    const mergedWithoutDrop = deepMergeObjects(collection.features, patch)

    expect(mergedWithDrop).toEqual(expectation)
    expect(mergedWithDrop).not.toEqual(mergedWithoutDrop)
  })
})
