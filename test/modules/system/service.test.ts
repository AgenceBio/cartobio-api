import * as repository from '../../../src/modules/system/system.repository.js'
import { getHealth, getUnavailableHealth, getVersion } from '../../../src/modules/system/system.service.js'
import packageJson from '../../../package.json' with { type: 'json' }

vi.mock('../../../src/modules/system/system.repository.js')

describe('system service', () => {
  test('signale la base disponible quand la vérification réussit', async () => {
    vi.mocked(repository.checkHealth).mockResolvedValue(undefined)

    expect(await getHealth()).toEqual({
      status: 'ok',
      db: 'ok',
      uptime: expect.any(Number),
      timestamp: expect.any(Number)
    })
  })

  test('propage une base injoignable', async () => {
    vi.mocked(repository.checkHealth).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getHealth()).rejects.toThrow('ECONNREFUSED')
  })

  test('décrit une base injoignable', () => {
    expect(getUnavailableHealth()).toMatchObject({ status: 'ok', db: 'unreachable' })
  })

  test('retourne la version du paquet', () => {
    expect(getVersion()).toBe(packageJson.version)
  })
})
