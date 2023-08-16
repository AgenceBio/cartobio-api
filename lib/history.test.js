const { collectFeatureIdsFromPayload } = require('./history.js')

const collection = {
  type: 'FeatureCollection',
  features: [
    {
      id: 1234
    },
    {
      id: 5678
    }
  ]
}

describe('collectFeatureIdsFromPayload()', () => {
  test('ignores when payload is not a featureCollection', () => {
    expect(collectFeatureIdsFromPayload()).toBeNull()
    expect(collectFeatureIdsFromPayload(null)).toBeNull()
    expect(collectFeatureIdsFromPayload({})).toBeNull()
  })

  test('collect ids from top level property', () => {
    expect(collectFeatureIdsFromPayload(collection)).toEqual([1234, 5678])
  })
})
