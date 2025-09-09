const exportPdf = require('./export-pdf')
const generatePdfContent = require('./generate-pdf-content')
const utils = require('./utils-pdf')
const pool = require('../db.js')
const { get } = require('got')
const agencebioOperator = require('./__fixtures__/agence-bio-operateur.json')
const parcelles = require('./__fixtures__/parcelles.json')
const { randomUUID } = require('crypto')
const { AttestationsProductionsStatus } = require('../enums.js')
const fs = require('fs')

jest.mock('./utils-pdf', () => ({
  getAllParcelles: jest.fn()
}))

jest.mock('./generate-pdf-content', () => ({
  createPdfContent: jest.fn()
}))

describe('Generation du PDF', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  it('on stock en base les resultat si aucune parcelle', async () => {
    pool.query.mockResolvedValue({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: [agencebioOperator]
    })
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    utils.getAllParcelles
      .mockResolvedValueOnce([])
    const UUID = randomUUID()
    const result = await exportPdf.generatePDF('123', UUID)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.ERROR, null])

    expect(pool.query).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ global: null, parcelles: [] })
  })

  it("on stock en base les resultat en cas d'exception", async () => {
    pool.query.mockResolvedValue({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: [agencebioOperator]
    })
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    utils.getAllParcelles
      .mockResolvedValueOnce(parcelles)
    generatePdfContent.createPdfContent.mockImplementation(() => { throw new Error('TEST') })
    const UUID = randomUUID()
    let hasTrown = false
    try {
      await exportPdf.generatePDF('123', UUID)
    } catch (e) {
      hasTrown = true
    }

    expect(hasTrown).toEqual(true)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.ERROR, null])

    expect(pool.query).toHaveBeenCalledTimes(4)
  })

  it('on stock en base les resultat en cas de succès', async () => {
    pool.query.mockResolvedValue({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: [agencebioOperator]
    })
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    utils.getAllParcelles
      .mockResolvedValueOnce(parcelles)

    jest.spyOn(fs, 'writeFile').mockImplementation(() => {})
    generatePdfContent.createPdfContent.mockResolvedValue({ save: () => 'save', saveAsBase64: () => 'save-as-base-64' })
    const UUID = randomUUID()
    const res = await exportPdf.generatePDF('123', UUID)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.GENERATED, expect.stringContaining(UUID + '.pdf')])

    expect(pool.query).toHaveBeenCalledTimes(4)

    expect(res).toEqual('save-as-base-64')
  })

  it('on ne regenere pas le pdf si il existe deja', async () => {
    pool.query.mockResolvedValue({
      rows: []
    }).mockResolvedValueOnce({
      rows: [{ path: 'test' }]
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: [agencebioOperator]
    })
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    utils.getAllParcelles
      .mockResolvedValueOnce(parcelles)

    jest.spyOn(fs, 'readFileSync').mockResolvedValue('test-file')

    const UUID = randomUUID()
    const res = await exportPdf.generatePDF('123', UUID)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID])

    expect(pool.query).toHaveBeenCalledTimes(1)

    expect(res).toEqual('test-file')
  })

  it('on ne regenere le pdf si le boolean force est a true', async () => {
    pool.query.mockResolvedValue({
      rows: []
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: [agencebioOperator]
    })
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    utils.getAllParcelles
      .mockResolvedValueOnce(parcelles)

    jest.spyOn(fs, 'readFileSync').mockResolvedValue('test-file')

    const UUID = randomUUID()
    const res = await exportPdf.generatePDF('123', UUID, true)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.STARTED, null])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.GENERATED, expect.stringContaining(UUID + '.pdf')])

    expect(pool.query).toHaveBeenCalledTimes(3)

    expect(res).toEqual('save-as-base-64')
  })

  it("regenere le pdf si le fichier n'existe pas malgré la ligne en BDD", async () => {
    pool.query.mockResolvedValue({
      rows: []
    }).mockResolvedValueOnce({
      rows: [{ path: 'test' }]
    }).mockResolvedValueOnce({
      rows: []
    }).mockResolvedValueOnce({
      rows: [agencebioOperator]
    })
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    utils.getAllParcelles
      .mockResolvedValueOnce(parcelles)

    generatePdfContent.createPdfContent.mockResolvedValue({ save: () => 'save', saveAsBase64: () => 'save-as-base-64' })
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('Erreur de test readFile') })

    const UUID = randomUUID()
    const res = await exportPdf.generatePDF('123', UUID)

    expect(pool.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.ERROR, null])
    expect(pool.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('SELECT'),
      [UUID])
    expect(pool.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT'),
      [UUID, AttestationsProductionsStatus.GENERATED, expect.stringContaining(UUID + '.pdf')])

    expect(pool.query).toHaveBeenCalledTimes(4)

    expect(res).toEqual('save-as-base-64')
  })
})
