import { z } from 'zod'

export const opt = <T extends z.ZodType>(schema: T, description: string): z.ZodOptional<z.ZodNullable<T>> =>
  schema.nullable().optional().meta({ description })
export const text = (description: string): z.ZodOptional<z.ZodNullable<z.ZodString>> => opt(z.string(), description)
export const textOrNumber = (
  description: string
): z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>> =>
  opt(z.union([z.string(), z.number()]), description)
export const booleanQuery = (description: string): z.ZodDefault<z.ZodCodec<z.ZodString, z.ZodBoolean>> =>
  z
    .stringbool()
    .default(false)
    .meta({ description: `${description} (\`true\` / \`false\`, défaut \`false\`)` })
export const optionalString = (description: string): z.ZodOptional<z.ZodString> =>
  z.string().optional().meta({ description })

export const mixiteSchema = z.enum(['AB', 'ABCONV', 'MIXTE'])
