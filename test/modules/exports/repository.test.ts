import * as exportPdf from '../../../src/modules/exports/exports.service.js'
import * as generatePdfContent from '../../../src/modules/exports/pdf-content.js'
import * as utils from '../../../src/modules/exports/pdf-utils.js'
import pool from '../../../src/database/database.js'
import config from '../../../src/config/env.js'
import { get } from '../../got-mock.js'
import agencebioOperator from '../../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }
import parcellesJSON from '../../fixtures/providers/parcelles.json' with { type: 'json' }
import { randomUUID } from 'crypto'
import { AttestationsProductionsStatus, AttestationsProductionsType } from '@agencebio/cartobio-types'
import fs from 'fs'
import { asPdfDocument, buildCulture, buildPdfParcelle, mockedQuery, queryResult } from '../../factories.js'

const parcelles = parcellesJSON.map(p => buildPdfParcelle({
  id: p.id,
  name: 'test',
  commune: p.commune,
  conversion_niveau: p.conversion_niveau,
  engagement_date: p.engagement_date,
  nbilot: p.numero_ilot_pac,
  nbp: p.numero_parcelle_pac,
  cultures: p.cultures.map(({ CPF, variete }) => buildCulture({ CPF, variete }))
}))
const generatedPdf = () => asPdfDocument({ save: vi.fn().mockReturnValue('save'), saveAsBase64: vi.fn().mockReturnValue('save-as-base-64') })

vi.mock('../../../src/modules/exports/pdf-utils.js', () => ({
  getAllParcelles: vi.fn()
}))

vi.mock('../../../src/modules/exports/pdf-content.js', () => ({
  createPdfContent: vi.fn()
}))

describe('Generation du PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(config, 'get').mockReturnValue('/tmp')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('on jette une exception si aucune parcelle', async () => {
    mockedQuery().mockResolvedValue(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([agencebioOperator]))
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles)
      .mockResolvedValueOnce([])
    const UUID = randomUUID()
    let hasTrown = false
    try {
      const gen = exportPdf.generatePDF('123', UUID)
      await gen.next()
    } catch (e) {
      console.error(e)
      hasTrown = true
    }

    expect(hasTrown).toEqual(true)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID, AttestationsProductionsType.COMPLET])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.ERROR, null])

    expect(pool.query).toHaveBeenCalledTimes(4)
  })

  it('on jette une exception si parcelle sans culture', async () => {
    mockedQuery().mockResolvedValue(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([agencebioOperator]))
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    const tmpParcelles = parcelles.map((p) => ({ ...p }))

    tmpParcelles[0].cultures = [buildCulture({ CPF: '' })]
    vi.mocked(utils.getAllParcelles)
      .mockResolvedValueOnce(tmpParcelles)
    const UUID = randomUUID()
    let hasTrown = false
    try {
      const gen = exportPdf.generatePDF('123', UUID)
      await gen.next()
    } catch (e) {
      console.error(e)
      hasTrown = true
    }

    expect(hasTrown).toEqual(true)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID, AttestationsProductionsType.COMPLET])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.ERROR, null])

    expect(pool.query).toHaveBeenCalledTimes(4)
  })

  it("on stock en base les resultat en cas d'exception", async () => {
    mockedQuery().mockResolvedValue(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([agencebioOperator]))
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })

    vi.mocked(utils.getAllParcelles)
      .mockResolvedValueOnce(parcelles)
    vi.mocked(generatePdfContent.createPdfContent).mockImplementation(() => { throw new Error('TEST') })
    const UUID = randomUUID()
    let hasTrown = false
    const gen = exportPdf.generatePDF('123', UUID)

    try {
      await gen.next()
      await gen.next()
    } catch (e) {
      console.error(e)
      hasTrown = true
    }

    expect(hasTrown).toEqual(true)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID, AttestationsProductionsType.COMPLET])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.ERROR, null])

    expect(pool.query).toHaveBeenCalledTimes(4)
  })

  it('on stock en base les resultat en cas de succès', async () => {
    mockedQuery().mockResolvedValue(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([agencebioOperator]))
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles)
      .mockResolvedValueOnce(parcelles)

    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])
    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID)

    const count = (await gen.next()).value
    expect(count).toEqual(3)
    const res = (await gen.next()).value

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID, AttestationsProductionsType.COMPLET])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.GENERATED, expect.stringContaining(UUID)])

    expect(pool.query).toHaveBeenCalledTimes(4)

    expect(res).toEqual('save-as-base-64')
  })

  it('on ne regenere pas le pdf si il existe deja', async () => {
    mockedQuery().mockResolvedValue(queryResult([])).mockResolvedValueOnce(queryResult([{ path: 'test' }])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([agencebioOperator]))
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles)
      .mockResolvedValueOnce(parcelles)

    vi.spyOn(fs, 'readFileSync').mockReturnValue('test-file')

    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID)

    const count = (await gen.next()).value
    expect(count).toEqual(0)
    const res = (await gen.next()).value

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID, AttestationsProductionsType.COMPLET])

    expect(pool.query).toHaveBeenCalledTimes(1)

    expect(res).toEqual('test-file')
  })

  it('on regenere le pdf si le boolean force est a true', async () => {
    mockedQuery().mockResolvedValue(queryResult([])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([agencebioOperator]))
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles)
      .mockResolvedValueOnce(parcelles)

    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])

    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID, true)

    const count = (await gen.next()).value
    expect(count).toEqual(3)
    const res = (await gen.next()).value

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.GENERATED, expect.stringContaining(UUID)])

    expect(pool.query).toHaveBeenCalledTimes(3)

    expect(res).toEqual('save-as-base-64')
  })

  it("regenere le pdf si le fichier n'existe pas malgré la ligne en BDD", async () => {
    mockedQuery().mockResolvedValue(queryResult([])).mockResolvedValueOnce(queryResult([{ path: 'test' }])).mockResolvedValueOnce(queryResult([])).mockResolvedValueOnce(queryResult([agencebioOperator]))
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    vi.mocked(utils.getAllParcelles)
      .mockResolvedValueOnce(parcelles)

    vi.mocked(generatePdfContent.createPdfContent).mockResolvedValue([generatedPdf()])
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('Erreur de test readFile') })

    const UUID = randomUUID()
    const gen = exportPdf.generatePDF('123', UUID)

    const count = (await gen.next()).value
    expect(count).toEqual(0)
    const regenerationCount = (await gen.next()).value
    expect(regenerationCount).toEqual(3)
    const res = (await gen.next()).value

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID, AttestationsProductionsType.COMPLET])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsType.COMPLET, AttestationsProductionsStatus.GENERATED, expect.stringContaining(UUID)])

    expect(pool.query).toHaveBeenCalledTimes(4)

    expect(res).toEqual('save-as-base-64')
  })
})
