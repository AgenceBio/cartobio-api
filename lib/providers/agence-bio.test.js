const { parsePacDetailsFromComment } = require('./agence-bio.js')

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
    expect(parsePacDetailsFromComment('')).toEqual({ numeroIlot: null, numeroParcelle: null })
    expect(parsePacDetailsFromComment('ilot-15-a')).toEqual({ numeroIlot: null, numeroParcelle: null })
    expect(parsePacDetailsFromComment('ilot a parcelle 5')).toEqual({ numeroIlot: null, numeroParcelle: null })
    expect(parsePacDetailsFromComment('ilot 12 parcelle a')).toEqual({ numeroIlot: null, numeroParcelle: null })
  })
})
