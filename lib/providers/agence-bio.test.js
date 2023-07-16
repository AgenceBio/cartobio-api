const { createReadStream } = require('fs')
const { join } = require('path')
const { parseAPIParcellaireStream, parsePacDetailsFromComment } = require('./agence-bio.js')

describe('parseAPIParcellaireStream', () => {
  test('turns a file into a working GeoJSON', async () => {
    const expectation = require('./__fixtures__/agence-bio-api-parcellaire_expectation.json')
    const fixtureFile = createReadStream(join(__dirname, '__fixtures__', 'agence-bio-api-parcellaire.json'))
    const organismeCertificateur = { id: 1, nom: 'Ecocert France' }

    const generator = parseAPIParcellaireStream(fixtureFile, { organismeCertificateur })
    const { value: result } = await generator.next()

    expect(result).toEqual(expectation)

    await expect(async () => await generator.next()).not.toThrow()
    await expect(await generator.next()).toMatchObject({
      value: {
        error: new SyntaxError('Unexpected end of JSON input')
      }
    })
  })
})

describe('parsePacDetailsFromComment', () => {
  test('detect Ilot et Parcelle from explicit naming', async () => {
    expect(parsePacDetailsFromComment('parcelle 5 ilot 12')).toEqual({ numeroIlot: '12', numeroParcelle: '5' })
    expect(parsePacDetailsFromComment('ilot 12 parcelle 5')).toEqual({ numeroIlot: '12', numeroParcelle: '5' })
  })

  test('detect Ilot et Parcelle from compact naming', async () => {
    expect(parsePacDetailsFromComment('ilot-15-2')).toEqual({ numeroIlot: '15', numeroParcelle: '2' })
    expect(parsePacDetailsFromComment('ilot-15-2')).toEqual({ numeroIlot: '15', numeroParcelle: '2' })
  })

  test('assume nothing', async () => {
    expect(parsePacDetailsFromComment('')).toEqual({ numeroIlot: '', numeroParcelle: '' })
    expect(parsePacDetailsFromComment('ilot-15-a')).toEqual({ numeroIlot: '', numeroParcelle: '' })
    expect(parsePacDetailsFromComment('ilot a parcelle 5')).toEqual({ numeroIlot: '', numeroParcelle: '' })
    expect(parsePacDetailsFromComment('ilot 12 parcelle a')).toEqual({ numeroIlot: '', numeroParcelle: '' })
  })
})
