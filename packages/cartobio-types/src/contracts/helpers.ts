import { z } from 'zod'

export function opt<T extends z.ZodType>(schema: T, description: string): z.ZodOptional<z.ZodNullable<T>> {
  return schema.nullable().optional().meta({ description })
}

export function text(description: string): z.ZodOptional<z.ZodNullable<z.ZodString>> {
  return opt(z.string(), description)
}

export function textOrNumber(
  description: string
): z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>> {
  return opt(z.union([z.string(), z.number()]), description)
}

export function booleanQuery(description: string): z.ZodDefault<z.ZodCodec<z.ZodString, z.ZodBoolean>> {
  return z
    .stringbool()
    .default(false)
    .meta({ description: `${description} (\`true\` / \`false\`, défaut \`false\`)` })
}

export function optionalString(description: string): z.ZodOptional<z.ZodString> {
  return z.string().optional().meta({ description })
}

export const mixiteSchema = z.enum(['AB', 'ABCONV', 'MIXTE'])
