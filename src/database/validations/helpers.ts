import { z } from "zod";

export const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? null : value), schema.nullable());

export const isoDate = emptyToNull(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : YYYY-MM-DD"),
);