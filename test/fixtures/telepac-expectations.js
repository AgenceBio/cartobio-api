const UUIDRe = /^[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+-[a-f0-9]+$/

module.exports = {
  single: {
    type: 'FeatureCollection',
    features: [
      {
        id: expect.toBeAFeatureId(),
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            expect.arrayContaining([[5.020622298258249, 44.73758401718037]])
          ]
        },
        properties: {
          id: expect.toBeAFeatureId(),
          remoteId: '1.3',
          COMMUNE: '26108',
          NUMERO_I: '1',
          NUMERO_P: '3',
          PACAGE: expect.stringMatching(/^(999000000|026532467)$/),
          conversion_niveau: 'CONV',
          cultures: [
            {
              CPF: '01.13.42',
              TYPE: 'AIL',
              id: expect.stringMatching(UUIDRe)
            }
          ]
        }
      }
    ]
  },
  multi: {
    type: 'FeatureCollection',
    features: [
      {
        id: expect.toBeAFeatureId(),
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            expect.arrayContaining([[6.0768655089466765, 47.685278906089444]]),
            expect.arrayContaining([[6.07727679068216, 47.68682804163941]]),
            expect.arrayContaining([[6.0770187939092795, 47.688111446343]])
          ]
        },
        properties: {
          id: expect.toBeAFeatureId(),
          remoteId: '1.1',
          COMMUNE: '70421',
          NUMERO_I: '1',
          NUMERO_P: '1',
          PACAGE: expect.stringMatching(/^(999000000|026532467)$/),
          conversion_niveau: 'CONV',
          cultures: [
            {
              CPF: '01.19.10.11',
              TYPE: 'PTR',
              id: expect.stringMatching(UUIDRe)
            }
          ]
        }
      },
      {
        id: expect.toBeAFeatureId(),
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            expect.arrayContaining([[6.065424536564729, 47.68858541466545]])
          ]
        },
        properties: {
          id: expect.toBeAFeatureId(),
          remoteId: '2.2',
          COMMUNE: '70421',
          NUMERO_I: '2',
          NUMERO_P: '2',
          PACAGE: expect.stringMatching(/^(999000000|026532467)$/),
          conversion_niveau: 'CONV',
          cultures: [
            {
              CPF: '01.19.10.12',
              TYPE: 'PPH',
              id: expect.stringMatching(UUIDRe)
            }
          ]
        }
      },
      {
        type: 'Feature',
        id: expect.toBeAFeatureId(),
        geometry: {
          type: 'Polygon',
          coordinates: [
            expect.arrayContaining([[6.069309706237855, 47.6882033150393]])
          ]
        },
        properties: {
          id: expect.toBeAFeatureId(),
          remoteId: '2.4',
          COMMUNE: '70421',
          NUMERO_I: '2',
          NUMERO_P: '4',
          PACAGE: expect.stringMatching(/^(999000000|026532467)$/),
          conversion_niveau: 'AB?',
          cultures: [
            {
              CPF: '01.11.12',
              TYPE: 'BTH',
              id: expect.stringMatching(UUIDRe)
            }
          ]
        }
      }
    ]
  }
}
