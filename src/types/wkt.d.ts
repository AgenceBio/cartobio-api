declare module 'wkt' {
  import type { Feature, Geometry } from 'geojson'

  export function parse (wkt: string): Geometry | null
  export function stringify (geojson: Geometry | Feature): string
}
