import { sql } from 'drizzle-orm'
import { db as drizzleDb } from '../src/database/database.js'
import {
  ensureOrganismeCertificateur,
  insertEvent,
  upsertCultures,
  upsertMetadata
} from '../src/shared/parcellaires/parcellaires.repository.js'
import type { CultureInput, HistoryEntry } from '@agencebio/cartobio-types'
import * as schema from '../src/database/schema/index.js'
import records from './fixtures/providers/records.json' with { type: 'json' }
import parcelles from './fixtures/providers/parcelles.json' with { type: 'json' }

type FixtureRecord = Partial<Record<keyof (typeof records)[number], unknown>>
type CertificationEtat = (typeof schema.parcellaires.certificationEtat.enumValues)[number]
type ConversionNiveau = (typeof schema.conversionNiveau.enumValues)[number]

export async function loadParcellairesFixture(
  data: typeof records = records,
  pinnedRecords: Array<string | number> = [],
  userId = 1
): Promise<void> {
  await drizzleDb
    .insert(schema.organismeCertificateur)
    .values(
      data
        .filter((record) => record.oc_id != null)
        .map((record) => ({ id: String(record.oc_id), label: record.oc_label }))
    )
    .onConflictDoNothing()

  await drizzleDb.insert(schema.parcellaires).values(
    data.map((record, i) => ({
      recordId: record.record_id,
      numeroBio: Number(record.numerobio),
      ocId: record.oc_id == null ? null : String(record.oc_id),
      certificationEtat: record.certification_state as CertificationEtat,
      certificationDateDebut: record.certification_date_debut,
      certificationDateFin: record.certification_date_fin,
      auditDate: record.audit_date,
      anneeReferenceControle: record.annee_reference_controle,
      auditNotesCertif: record.audit_notes,
      auditDemandesOperateur: record.audit_demandes,
      versionNom: record.version_name,
      createdAt: sql`now() + make_interval(mins => ${i})`,
      updatedAt: sql`now() + make_interval(mins => ${i})`
    }))
  )

  if (pinnedRecords.length > 0) {
    await drizzleDb
      .insert(schema.operateursEpingles)
      .values(pinnedRecords.map((numeroBio) => ({ numeroBio: Number(numeroBio), userId: String(userId) })))
      .onConflictDoNothing()
  }

  await drizzleDb.insert(schema.parcelles).values(
    data.flatMap((record) =>
      parcelles.map((parcelle) => {
        const geometry = sql`ST_GeomFromGeoJSON(${JSON.stringify(parcelle.geometry)})`

        return {
          recordId: record.record_id,
          id: parcelle.id,
          geometry,
          surfaceHa: sql`ST_Area(${geometry}::geography) / 10000`,
          conversionNiveau: parcelle.conversion_niveau as ConversionNiveau | null,
          engagementDate: parcelle.engagement_date,
          numeroIlotPac: parcelle.numero_ilot_pac ? Number(parcelle.numero_ilot_pac) : null,
          numeroParcellesPac: parcelle.numero_parcelle_pac ? Number(parcelle.numero_parcelle_pac) : null
        }
      })
    )
  )
}

export async function loadRecordFixture(
  data: FixtureRecord[] = records,
  pinnedRecords: Array<string | number> = [],
  userId = 1
) {
  await drizzleDb.delete(schema.parcelles)
  await drizzleDb.delete(schema.parcellaires)
  for (let i = 0; i < data.length; i++) {
    const record = data[i]!
    await ensureOrganismeCertificateur(drizzleDb, record.oc_id as number | null, record.oc_label as string | null)
    await drizzleDb.insert(schema.parcellaires).values({
      recordId: record.record_id as string,
      versionNom: record.version_name as string,
      numeroBio: Number(record.numerobio),
      certificationEtat: record.certification_state as CertificationEtat,
      certificationDateDebut: record.certification_date_debut as string | null,
      certificationDateFin: record.certification_date_fin as string | null,
      auditDate: record.audit_date as string | null,
      auditNotesCertif: record.audit_notes as string | null,
      auditDemandesOperateur: record.audit_demandes as string | null,
      ocId: record.oc_id == null ? null : String(record.oc_id),
      createdAt: sql`now()`,
      updatedAt: sql`now() + make_interval(mins => ${i})`,
      anneeReferenceControle: sql`COALESCE(${record.annee_reference_controle ?? null}::int, DATE_PART('year', now()))`
    })
    await upsertMetadata(drizzleDb, record.record_id as string, record.metadata as Record<string, unknown> | null)
    for (const entry of (record.audit_history ?? []) as HistoryEntry[]) {
      await insertEvent(drizzleDb, record.record_id as string, entry)
    }
  }

  if (pinnedRecords && pinnedRecords.length > 0) {
    await drizzleDb
      .insert(schema.operateursEpingles)
      .values(pinnedRecords.map((numeroBio) => ({ numeroBio: Number(numeroBio), userId: String(userId) })))
      .onConflictDoNothing()
  }

  for (let i = 0; i < data.length; i++) {
    const record = data[i]!
    for (let j = 0; j < parcelles.length; j++) {
      const parcelle: (typeof parcelles)[number] & { commentaire?: string } = parcelles[j]!
      const geometry = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(parcelle.geometry)}), 4326)`
      await drizzleDb.insert(schema.parcelles).values({
        recordId: record.record_id as string,
        id: parcelle.id,
        geometry,
        surfaceHa: sql`round((ST_Area(${geometry}::geography) / 10000)::numeric, 4)`,
        commune: parcelle.commune,
        createdAt: sql`now() + make_interval(mins => ${j})`,
        conversionNiveau: parcelle.conversion_niveau as ConversionNiveau | null,
        engagementDate: parcelle.engagement_date,
        numeroIlotPac: parcelle.numero_ilot_pac ? Number(parcelle.numero_ilot_pac) : null,
        numeroParcellesPac: parcelle.numero_parcelle_pac ? Number(parcelle.numero_parcelle_pac) : null,
        commentaireOperateur: parcelle.commentaire
      })
      await upsertCultures(
        drizzleDb,
        record.record_id as string,
        parcelle.id,
        parcelle.cultures as unknown as CultureInput[]
      )
    }
  }
}

function asStoredCultures(cultures: Array<Record<string, unknown>> | null | undefined): Array<Record<string, unknown>> {
  return (cultures ?? []).map(({ surface, date_semis: dateSemis, ...culture }) => ({
    ...Object.fromEntries(Object.entries(culture).filter(([key, value]) => key !== 'id' && value !== '')),
    ...(surface != null && surface !== '' ? { surface: Number(surface) } : {}),
    ...(dateSemis ? { date_semis: dateSemis } : {})
  }))
}

export function asStoredParcelles<
  T extends {
    cultures?: Array<Record<string, unknown>> | null
    historique_cultures?: Array<{ cultures?: Array<Record<string, unknown>> | null }> | null
  }
>(items: T[]): T[] {
  return items.map((parcelle) => ({
    ...parcelle,
    annotations: [],
    cultures: asStoredCultures(parcelle.cultures),
    ...(parcelle.historique_cultures
      ? {
          historique_cultures: parcelle.historique_cultures.map((historique) => ({
            ...historique,
            cultures: asStoredCultures(historique.cultures)
          }))
        }
      : {})
  }))
}

const expectDeepCloseTo = <T>(value: T): T => {
  if (value === null) {
    return value
  }

  // If value is an array, apply recursively to all elements
  if (Array.isArray(value)) {
    return value.map(expectDeepCloseTo) as T
  }

  // If value is on object, apply recursively to all properties
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key in value) {
      result[key] = expectDeepCloseTo(value[key])
    }

    return result as T
  }

  // If value is a float number, use toBeCloseTo
  if (typeof value === 'number' && value % 1 !== 0) {
    return expect.closeTo(value) as T
  }

  return value
}

export { expectDeepCloseTo }
