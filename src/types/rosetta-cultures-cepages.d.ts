
declare module '@agencebio/rosetta-cultures/cepages' {
  import type { Cepage } from '@agencebio/rosetta-cultures'

  export function fromCepageCode (code: string | number): Cepage | null
}
