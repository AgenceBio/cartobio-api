import { z } from 'zod'
import { parseApiList, parseApiResponse } from '../../src/clients/clients.utils.js'
import { logger } from '../../src/config/logger.js'

const schema = z.object({ id: z.number() })

describe('parseApiResponse', () => {
  test('retourne la donnée validée', () => {
    expect(parseApiResponse(schema, { id: 1, extra: true }, "l'API")).toEqual({ id: 1 })
  })

  test('transforme une réponse invalide en erreur 502', () => {
    expect(() => parseApiResponse(schema, { id: 'a' }, "l'API Test")).toThrow(
      expect.objectContaining({
        statusCode: 502,
        message: "Erreur serveur : réponse inattendue de l'API Test"
      })
    )
  })
})

describe('parseApiList', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('ignore les éléments invalides en le journalisant', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    expect(parseApiList(schema, [{ id: 1 }, { id: 'a' }, null, { id: 2 }], "l'API")).toEqual([{ id: 1 }, { id: 2 }])
    expect(warn).toHaveBeenCalledWith(expect.anything(), "2 élément(s) inattendu(s) ignoré(s) dans l'API")
  })

  test('ne journalise rien quand tout est valide', () => {
    const warn = vi.spyOn(logger, 'warn')

    expect(parseApiList(schema, [{ id: 1 }], "l'API")).toEqual([{ id: 1 }])
    expect(warn).not.toHaveBeenCalled()
  })
})
