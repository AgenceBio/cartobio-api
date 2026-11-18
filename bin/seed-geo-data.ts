#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../src/database/database.js'
import { communes, departements, regions } from '../src/database/schema/geographie.js'
import { fromGeoJSON } from '../src/database/postgis.js'
import { DATA_DIR } from '../src/shared/paths.js'

type Zone = { code: string; nom: string; geometry: unknown }

const multiPolygon = (geometry: unknown): SQL =>
  sql`ST_Multi(ST_CollectionExtract(ST_SetSRID(${fromGeoJSON(geometry)}, 4326), 3))`

async function readZones(file: string): Promise<Zone[]> {
  const zones = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as Zone[]
  return zones.filter(({ nom, geometry }) => nom !== '' && geometry)
}

async function byBatch<T extends Zone>(zones: T[], upsert: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < zones.length; i += 1000) {
    await upsert(zones.slice(i, i + 1000))
  }
}

try {
  await db.transaction(async (tx) => {
    await byBatch(await readZones('reference/regions.json'), (batch) =>
      tx
        .insert(regions)
        .values(batch.map(({ code, nom, geometry }) => ({ code, nom, geometry: multiPolygon(geometry) })))
        .onConflictDoUpdate({ target: regions.code, set: { nom: sql`excluded.nom`, geometry: sql`excluded.geometry` } })
    )

    const located: Array<Zone & { codeRegion: string }> = []
    for (const departement of await readZones('reference/departements.json')) {
      const [region] = await tx
        .select({ code: regions.code })
        .from(regions)
        .where(sql`ST_Contains(${regions.geometry}, ST_PointOnSurface(${multiPolygon(departement.geometry)}))`)
        .limit(1)
      if (region) located.push({ ...departement, codeRegion: region.code })
    }

    await byBatch(located, (batch) =>
      tx
        .insert(departements)
        .values(
          batch.map(({ code, nom, geometry, codeRegion }) => ({
            fid: code,
            nom,
            geometry: multiPolygon(geometry),
            codeRegion
          }))
        )
        .onConflictDoUpdate({
          target: departements.fid,
          set: { nom: sql`excluded.nom`, geometry: sql`excluded.geometry`, codeRegion: sql`excluded.code_region` }
        })
    )

    await tx.update(communes).set({ active: false })
    await byBatch(
      (await readZones('generated/communes.json')).filter(({ code }) => code.length <= 5),
      (batch) =>
        tx
          .insert(communes)
          .values(
            batch.map(({ code, nom, geometry }) => ({ fid: code, nom, active: true, geometry: multiPolygon(geometry) }))
          )
          .onConflictDoUpdate({
            target: communes.fid,
            set: { nom: sql`excluded.nom`, geometry: sql`excluded.geometry`, active: true }
          })
    )
  })
  console.log('Régions, départements et communes importés')
} finally {
  await db.$client.end()
}
