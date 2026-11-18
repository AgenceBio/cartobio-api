declare module 'reproject' {
  import type { GeoJSON } from 'geojson'

  type Crs = string | object
  type Projections = Record<string, Crs>

  interface Reproject {
    reproject<T extends GeoJSON> (geojson: T, from: Crs | undefined, to: Crs, projs?: Projections): T
    toWgs84<T extends GeoJSON> (geojson: T, from?: Crs, projs?: Projections): T
    reverse<T extends GeoJSON> (geojson: T): T
    detectCrs (geojson: GeoJSON, projs: Projections): Crs
  }

  const reproject: Reproject
  export = reproject
}
