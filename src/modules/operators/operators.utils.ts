import type { NumeroBio } from './operators.types.js'

export function numerosBioEntiers(numerosBio: NumeroBio[]): number[] {
  return numerosBio.map(Number).filter((numeroBio) => Number.isSafeInteger(numeroBio))
}
