import { sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'
import type { Geometry } from 'geojson'

export function fromGeoJSON (geometry: unknown): SQL {
  return sql`ST_GeomFromGeoJSON(${JSON.stringify(geometry)})`
}

export function asGeoJSON (geometry: SQLWrapper): SQL<Geometry | null> {
  return sql<Geometry | null>`ST_AsGeoJSON(${geometry})::json`
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
