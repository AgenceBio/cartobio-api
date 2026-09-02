const { mergeSchemas, protectedWithToken } = require('../../routes')
const controller = require('./controller')
const { parcellaireRoutes } = require('./routes')

jest.mock('../../routes', () => ({
  protectedWithToken: jest.fn(),
  mergeSchemas: jest.fn()
}))

jest.mock('./controller', () => ({
  getGeneralKpi: jest.fn(),
  getTableauBilan: jest.fn(),
  getTableauErreurs: jest.fn(),
  getHistoriqueSpecificParcellaire: jest.fn(),
  getTopAnomalies: jest.fn(),
  getTopAnomaliesGrouped: jest.fn(),
  getRepetErreurs: jest.fn()
}))

describe('parcellaireRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(protectedWithToken).mockReturnValue({ preHandler: [] })
    jest.mocked(mergeSchemas).mockReturnValue({})
  })

  it('enregistre toutes les routes GET avec le même schéma de protection', async () => {
    const get = jest.fn()
    await parcellaireRoutes({ get }, {}
    )

    expect(protectedWithToken).toHaveBeenCalledWith({ oc: true, cartobio: true })
    expect(mergeSchemas).toHaveBeenCalledTimes(7)
    expect(get).toHaveBeenCalledTimes(7)

    expect(get).toHaveBeenNthCalledWith(1, '/general-kpi', expect.any(Object), controller.getGeneralKpi)
    expect(get).toHaveBeenNthCalledWith(2, '/tableau', expect.any(Object), controller.getTableauBilan)
    expect(get).toHaveBeenNthCalledWith(3, '/tableau-errors', expect.any(Object), controller.getTableauErreurs)
    expect(get).toHaveBeenNthCalledWith(4, '/historique', expect.any(Object), controller.getHistoriqueSpecificParcellaire)
    expect(get).toHaveBeenNthCalledWith(5, '/top-anomalies', expect.any(Object), controller.getTopAnomalies)
    expect(get).toHaveBeenNthCalledWith(6, '/top-anomalies-grouped', expect.any(Object), controller.getTopAnomaliesGlobal)
    expect(get).toHaveBeenNthCalledWith(7, '/repet-ano', expect.any(Object), controller.getRepetErreurs)
  })
})