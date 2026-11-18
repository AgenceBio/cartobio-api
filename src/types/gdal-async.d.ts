import type { Geometry as GeoJSONGeometry } from 'geojson'

declare module 'gdal-async' {
  interface Geometry {
    toObject(): GeoJSONGeometry
  }
}
