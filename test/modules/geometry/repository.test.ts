import { loadParcellairesFixture } from '../../utils.js'
import records from '../../fixtures/providers/records.json' with { type: 'json' }
import { verifyGeometry } from '../../../src/modules/geometry/geometry.service.js'

describe('verifyGeometry', () => {
  beforeEach(async () => {
    await loadParcellairesFixture()
  })

  test("Une geometry valide ne renvoie pas d'erreur", async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [6.762183076989215, 48.981124367260236],
          [6.764415065370428, 48.97673032941583],
          [6.765960288095883, 48.98095537296746],
          [6.762183076989215, 48.981124367260236]
        ]
      ]
    }
    expect(await verifyGeometry(geomGeoJSon, records[0].record_id)).toEqual({
      valid: true
    })
  })
  test('Une geometry inclus dans une autre renvoie une erreur', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [
            5.00742078063729,
            44.71418584175069
          ],
          [
            5.00619098801252,
            44.71418584175069
          ],
          [
            5.00619098801252,
            44.71353436914191
          ],
          [
            5.00742078063729,
            44.71353436914191
          ],
          [
            5.00742078063729,
            44.71418584175069
          ]
        ]
      ]
    }
    expect(await verifyGeometry(geomGeoJSon, records[0].record_id)).toEqual({
      valid: false
    })
  })

  test('Une geometry ne peux pas se chevaucher toute seule', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [
            5.0072,
            44.72
          ],
          [
            5.00619098801252,
            44.71418584175069
          ],
          [
            5.00619098801252,
            44.71353436914191
          ],
          [
            5.00742078063729,
            44.71353436914191
          ],
          [
            5.0072,
            44.72
          ]
        ]
      ]
    }

    expect(await verifyGeometry(geomGeoJSon, records[0].record_id, 1)).toEqual({
      valid: true
    })
  })
  test('Une geometry qui chevauche une autre renvoie une erreur et la correction', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [
            5.0072,
            44.72
          ],
          [
            5.00619098801252,
            44.71418584175069
          ],
          [
            5.00619098801252,
            44.71353436914191
          ],
          [
            5.00742078063729,
            44.71353436914191
          ],
          [
            5.0072,
            44.72
          ]
        ]
      ]
    }
    expect(await verifyGeometry(geomGeoJSon, records[0].record_id)).toEqual({
      valid: false,
      corrections: [{
        id: '1',
        existing_minus_intersection: {
          coordinates: [
            [
              [
                5.007420781,
                44.714185842
              ],
              [
                5.007420781,
                44.713534369
              ],
              [
                5.007398535,
                44.714185842
              ],
              [
                5.007420781,
                44.714185842
              ]
            ]
          ],
          type: 'Polygon'
        },
        new_minus_intersection: {
          coordinates: [
            [
              [
                5.0072,
                44.72
              ],
              [
                5.007398535,
                44.714185842
              ],
              [
                5.006190988,
                44.714185842
              ],
              [
                5.0072,
                44.72
              ]
            ]
          ],
          type: 'Polygon'
        },
        intersection: {
          type: 'Polygon',
          coordinates: [
            [
              [
                5.007398535,
                44.714185842
              ],
              [
                5.007420781,
                44.713534369
              ],
              [
                5.006190988,
                44.713534369
              ],
              [
                5.006190988,
                44.714185842
              ],
              [
                5.007398535,
                44.714185842
              ]
            ]
          ]
        }
      }]
    })
  })

  test('Une geometry qui chevauche plusieurs autres renvoie une erreur et la correction', async () => {
    const geomGeoJSon = {
      type: 'Polygon',
      coordinates: [
        [
          [
            2.83,
            44.300
          ],
          [
            6.00619098801252,
            44.71418584175069
          ],
          [
            5.00619098801252,
            44.71353436914191
          ],
          [
            5.00742078063729,
            44.71353436914191
          ],
          [
            2.83,
            44.300
          ]
        ]
      ]
    }

    expect(await verifyGeometry(geomGeoJSon, records[0].record_id)).toEqual({
      valid: false,
      corrections: [
        {
          id: '1',
          new_minus_intersection: {
            type: 'Polygon',
            coordinates: [
              expect.anything()
            ]
          },
          existing_minus_intersection: {
            type: 'Polygon',
            coordinates: [
              expect.anything()
            ]
          },
          intersection: {
            type: 'Polygon',
            coordinates: [
              expect.anything()
            ]
          }
        },
        {
          id: '2',
          new_minus_intersection: {
            type: 'Polygon',
            coordinates: [
              expect.anything()
            ]
          },
          existing_minus_intersection: {
            type: 'Polygon',
            coordinates: [
              expect.anything()
            ]
          },
          intersection: {
            type: 'Polygon',
            coordinates: [
              expect.anything()
            ]
          }
        }
      ]
    })
  })
})
