const { createReadStream } = require('fs')
const { join } = require('path')
const { parseAPIParcellaireStream } = require('./agence-bio.js')

describe('parseAPIParcellaireStream', () => {
  test('turns a file into a working GeoJSON', async () => {
    const expectation = require('./__fixtures__/agence-bio-api-parcellaire_expectation.json')
    const fixtureFile = createReadStream(join(__dirname, '__fixtures__', 'agence-bio-api-parcellaire.json'))
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }

    const generator = parseAPIParcellaireStream(fixtureFile, { organismeCertificateur })
    const { value: result } = await generator.next()

    expect(result).toEqual(expectation)
  })
})
