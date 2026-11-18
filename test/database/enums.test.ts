import { ImportJobEtat, ImportJobResult, ImportLogCode } from '@agencebio/cartobio-types'
import { importJobEtat, importJobResult } from '../../src/database/schema/enums.js'
import { createImportLogSchema } from '../../src/database/validations/imports.js'

describe('enums partagés avec le front', () => {
  test.each([
    ['ImportJobResult', ImportJobResult, importJobResult.enumValues],
    ['ImportJobEtat', ImportJobEtat, importJobEtat.enumValues]
  ])('%s du package correspond exactement à l’enum PostgreSQL', (_, packageEnum, dbValues) => {
    expect(new Set(Object.values(packageEnum))).toEqual(new Set(dbValues))
  })

  test("refuse d'écrire un log avec un code inconnu du package", () => {
    const log = { importId: 1, type: 'error' as const, message: 'm' }

    expect(createImportLogSchema.safeParse({ ...log, code: ImportLogCode.DB_ERROR }).success).toBe(true)
    expect(createImportLogSchema.safeParse({ ...log, code: 'CODE_INVENTE' }).success).toBe(false)
  })
})
