const { batchSlice } = require('./parcels.js')

const newArray = (size) => new Array(size).fill('@')

describe('batchSlice', () => {
  test('an empty list gives an empty list of batches', () => {
    expect(batchSlice(newArray(0))).toEqual([])
  })

  test('a list is grouped into 1 batch', () => {
    expect(batchSlice(newArray(3), 3)).toEqual([['@', '@', '@']])
  })

  test('an oversized list is grouped into 2 batches', () => {
    expect(batchSlice(newArray(6), 3)).toEqual([['@', '@', '@'], ['@', '@', '@']])
  })

  test('a slightly above threshold list of items is grouped into 3 batches', () => {
    expect(batchSlice(newArray(7), 3)).toEqual([['@', '@', '@'], ['@', '@', '@'], ['@']])
  })
})
