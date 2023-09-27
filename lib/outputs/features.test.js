const { deepMergeObjects, getRandomFeatureId, populateWithCentroid, populateWithMultipleCultures, updateCollectionFeatures } = require('./features.js')

describe('deepMergeObjects()', () => {
  test('we update an existing feature with explicit properties (eg: single feature edit)', () => {
    const feature = {
      type: 'Feature',
      id: 1234,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
      audit_history: [
        { type: 'CertificationStateChange', state: 'OPERATOR_DRAFT', date: '2021-01-01' }
      ],
      properties: {
        comment: 'coucou',
        certification_state: 'DRAFT'
      }
    }

    const patch = {
      properties: {
        comment: '',
        cultures: [
          { CPF: '1.13.41.1', id: 'aaaa-bbbb-cccc-dddd' }
        ],
        engagement_date: '2022-01-01'
      }
    }

    const expectation = {
      type: 'Feature',
      id: 1234,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
      audit_history: [
        { type: 'CertificationStateChange', state: 'OPERATOR_DRAFT', date: '2021-01-01' }
      ],
      properties: {
        comment: '',
        certification_state: 'DRAFT',
        cultures: [
          { CPF: '1.13.41.1', id: 'aaaa-bbbb-cccc-dddd' }
        ],
        engagement_date: '2022-01-01'
      }
    }

    expect(deepMergeObjects(feature, patch)).toEqual(expectation)
  })

  test('we combine existing and updated single field properties for partial features (eg: mass action of engagement_date on a collection)', () => {
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
              { id: 'aaaa', CPF: '', TYPE: 'PCL' }
            ]
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

    const patch = {
      features: [
        {
          id: 1234,
          properties: {
            comment: '',
            cultures: [
              { id: 'aaaa', CPF: '', TYPE: 'PCL' }
            ]
          }
        }
      ]
    }

    const expectation = {
      type: 'FeatureCollection',
      features: [
        {
          id: 1234,
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
          properties: {
            comment: '',
            certification_state: 'DRAFT',
            cultures: [
              { id: 'aaaa', CPF: '', TYPE: 'PCL' }
            ]
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

    expect(deepMergeObjects(collection, patch)).toEqual(expectation)
  })

  test('we combine existing and updated multi-field properties for partial features (eg: mass action of cultures on a collection)', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        {
          id: 1234,
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
          properties: {
            comment: 'coucou',
            conversion_niveau: 'AB',
            annotations: [{ code: 'surveyed', date: '2023-01-01' }],
            cultures: [
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
            conversion_niveau: 'AB',
            annotations: [{ code: 'surveyed', date: '2023-01-01' }],
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

    const patch = {
      features: [
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
    }

    const expectation = {
      type: 'FeatureCollection',
      features: [
        {
          id: 1234,
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
          properties: {
            comment: 'coucou',
            conversion_niveau: 'AB',
            annotations: [{ code: 'surveyed', date: '2023-01-01' }],
            cultures: [
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
          geometry: { type: 'Polygon', coordinates: [[[2, 2], [89, 89]]] },
          properties: {
            conversion_niveau: 'AB',
            annotations: [{ code: 'surveyed', date: '2023-01-01' }],
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
    }

    const mergedWithDrop = deepMergeObjects(collection, patch, deepMergeObjects.DROP_MISSING_IDS)
    const mergedWithoutDrop = deepMergeObjects(collection, patch)

    expect(mergedWithDrop).toEqual(expectation)
    expect(mergedWithDrop).not.toEqual(mergedWithoutDrop)
  })
})

describe('getRandomFeatureId', () => {
  test('returns a GeoJSON compatible feature id', () => {
    // 281474976710656 === Math.pow(2, 48)
    expect(getRandomFeatureId()).toBeLessThan(281474976710656)
  })
})

describe('populateWithCentroid', () => {
  test('does nothing if the feature does not contain a COMMUNE code', () => {
    const feature = {
      type: 'Feature',
      properties: {
        id: 'aaaa'
      }
    }

    const featureWithEmptyCommune = {
      type: 'Feature',
      properties: {
        id: 'aaaa',
        COMMUNE: ''
      }
    }

    const featureWithNullCommune = {
      type: 'Feature',
      properties: {
        id: 'aaaa',
        COMMUNE: null
      }
    }

    expect(populateWithCentroid(feature)).toEqual(feature)
    expect(populateWithCentroid(featureWithEmptyCommune)).toEqual(featureWithEmptyCommune)
    expect(populateWithCentroid(featureWithNullCommune)).toEqual(featureWithNullCommune)
  })

  test('adds COMMUNE_LABEL if the feature contains a COMMUNE code', () => {
    const featureWithOkayCode = {
      type: 'Feature',
      properties: {
        id: 'aaaa',
        COMMUNE: '26108'
      }
    }

    const featureWithNonExistingCode = {
      type: 'Feature',
      properties: {
        id: 'aaaa',
        COMMUNE: '99999'
      }
    }

    expect(populateWithCentroid(featureWithOkayCode)).toHaveProperty('properties.COMMUNE_LABEL', 'Crest')
    expect(populateWithCentroid(featureWithNonExistingCode)).toEqual(featureWithNonExistingCode)
  })

  test('does nothing if the feature contains AND a COMMUNE code AND a COMMUNE_LABEL property', () => {
    const featureWithArbitraryLabel = {
      type: 'Feature',
      properties: {
        id: 'aaaa',
        COMMUNE: '26108',
        COMMUNE_LABEL: 'Crestpuscule'
      }
    }

    expect(populateWithCentroid(featureWithArbitraryLabel)).toEqual(featureWithArbitraryLabel)
  })
})

describe('populateWithMultipleCultures', () => {
  // @see https://fr.wikipedia.org/wiki/Universally_unique_identifier
  const UUID_RE = /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/

  test('converts into a new structure if `cultures` is not an array', () => {
    const feature = {
      type: 'Feature',
      properties: {
        TYPE: 'PCL',
        variete: 'abc',
        SURF: '1.2'
      }
    }
    const expectation = {
      type: 'Feature',
      properties: {
        cultures: [
          { TYPE: 'PCL', CPF: '01.19.10.11', variete: 'abc', surface: '1.2' }
        ]
      }
    }

    expect(populateWithMultipleCultures(feature)).toMatchObject(expectation)
    expect(populateWithMultipleCultures(feature)).toHaveProperty('properties.cultures[0].id', expect.stringMatching(UUID_RE))
  })

  test('adds CPF codes whenever they are missing', () => {
    const featureWithKnownCPF = {
      type: 'Feature',
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'PCL', variete: 'abc' },
          { id: 'bbbb', TYPE: 'AGR' } /* is_selectable === true ?? */
        ]
      }
    }

    const expectationWithKnownCPF = {
      type: 'Feature',
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'PCL', CPF: '01.19.10.11', variete: 'abc' },
          { id: 'bbbb', TYPE: 'AGR', CPF: '01.23.1' }
        ]
      }
    }

    const featureWithUnknownCPF = {
      type: 'Feature',
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'ZZZ', variete: 'abc' },
          { id: 'bbbb', TYPE: '@@@' }
        ]
      }
    }

    const expectationWithUnknownCPF = {
      type: 'Feature',
      properties: {
        cultures: [
          { id: 'aaaa', TYPE: 'ZZZ', variete: 'abc' },
          { id: 'bbbb', TYPE: '@@@', CPF: undefined }
        ]
      }
    }

    expect(populateWithMultipleCultures(featureWithKnownCPF)).toEqual(expectationWithKnownCPF)
    expect(populateWithMultipleCultures(featureWithUnknownCPF)).toEqual(expectationWithUnknownCPF)
  })

  test('keeps properties untouched if a feature has multiple cultures structure', () => {
    const featureWithPAC = {
      type: 'Feature',
      properties: {
        TYPE: 'PCL',
        cultures: [
          { id: 'aaaa', CPF: '01.19.10.11', TYPE: 'PCL' }
        ]
      }
    }

    const featureWithCPF = {
      type: 'Feature',
      properties: {
        CPF: '01.19.10.12',
        cultures: [
          { id: 'aaaa', CPF: '01.19.10.12' },
          { id: 'aaaa', CPF: '01.11.2' }
        ]
      }
    }

    expect(populateWithMultipleCultures(featureWithPAC)).toEqual(featureWithPAC)
    expect(populateWithMultipleCultures(featureWithCPF)).toEqual(featureWithCPF)
  })
})

describe('updateCollectionFeatures', () => {
  test('merge a collection with partial features (eg: after deepMerging their properties)', () => {
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
              { id: 'aaaa', CPF: '', TYPE: 'PCL' },
              { id: 'cccc', CPF: '01.19.10.13' }
            ]
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

    const features = [
      {
        id: 1234,
        properties: {
          cultures: [
            { id: 'aaaa', CPF: '01.19.10.11' },
            { id: 'bbbb', CPF: '01.19.10.12' }
          ]
        }
      }
    ]

    const expectation = {
      type: 'FeatureCollection',
      features: [
        {
          id: 1234,
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [90, 90]]] },
          properties: {
            comment: 'coucou',
            certification_state: 'DRAFT',
            cultures: [
              { id: 'aaaa', CPF: '01.19.10.11' },
              { id: 'bbbb', CPF: '01.19.10.12' }
            ]
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

    expect(updateCollectionFeatures(collection, features)).toEqual(expectation)
  })
})
