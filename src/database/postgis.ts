import { sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import type { Geometry } from 'geojson'

export function fromGeoJSON (geometry: unknown): SQL {
  return sql`ST_GeomFromGeoJSON(${JSON.stringify(geometry)})`
}

export function wgs84FromGeoJSON (geometry: unknown): SQL {
  return sql`ST_SetSRID(${fromGeoJSON(geometry)}, 4326)`
}

export function areaHa (geometry: SQLWrapper): SQL {
  return sql`round((ST_Area(${geometry}::geography) / 10000)::numeric, 4)`
}

export function asGeoJSON<T extends Geometry = Geometry> (geometry: SQLWrapper): SQL<T | null> {
  return sql<T | null>`ST_AsGeoJSON(${geometry})::json`
}

export function webMercator (geometry: SQLWrapper): SQL {
  return sql`ST_Transform(ST_SetSRID(${geometry}, 4326), 3857)`
}

export function asWgs84GeoJSON (geometry: SQLWrapper): SQL<Geometry | null> {
  return asGeoJSON(sql`ST_Transform(${geometry}, 4326)`)
}

export function makeValid (geometry: SQLWrapper): SQL {
  return sql`ST_MakeValid(${geometry})`
}
