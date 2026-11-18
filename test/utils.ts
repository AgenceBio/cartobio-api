import { sql } from 'drizzle-orm'
import db, { db as drizzleDb } from '../src/database/database.js'
import * as schema from '../src/database/schema/index.js'
import records from './fixtures/providers/records.json' with { type: 'json' }
import parcelles from './fixtures/providers/parcelles.json' with { type: 'json' }

type FixtureRecord = Partial<Record<keyof (typeof records)[number], unknown>>
type CertificationEtat = (typeof schema.parcellaires.certificationEtat.enumValues)[number]
type ConversionNiveau = (typeof schema.conversionNiveau.enumValues)[number]

export async function loadParcellairesFixture (data: typeof records = records, pinnedRecords: Array<string | number> = [], userId = 1): Promise<void> {
  await drizzleDb
    .insert(schema.organismeCertificateur)
    .values(data.filter((record) => record.oc_id != null).map((record) => ({ id: String(record.oc_id), label: record.oc_label })))
    .onConflictDoNothing()

  await drizzleDb.insert(schema.parcellaires).values(data.map((record, i) => ({
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
  })))

  if (pinnedRecords.length > 0) {
    await drizzleDb
      .insert(schema.operateursEpingles)
      .values(pinnedRecords.map((numeroBio) => ({ numeroBio: Number(numeroBio), userId: String(userId) })))
      .onConflictDoNothing()
  }

  await drizzleDb.insert(schema.parcelles).values(data.flatMap((record) => parcelles.map((parcelle) => {
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
  })))
}

export async function loadRecordFixture (data: FixtureRecord[] = records, pinnedRecords: Array<string | number> = [], userId = 1) {
  await db.query('TRUNCATE TABLE cartobio_parcelles')
  await db.query('DELETE FROM cartobio_operators')
  for (let i = 0; i < data.length; i++) {
    const record = data[i]
    await db.query(
      /* sql */`
        INSERT INTO cartobio_operators
        (record_id, version_name, numerobio, certification_state, certification_date_debut,
         certification_date_fin, audit_date, audit_notes, audit_demandes, audit_history, metadata, oc_id,
         oc_label, created_at, updated_at, annee_reference_controle)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, now(), now() + ($15 ||' minutes')::INTERVAL, COALESCE($14, DATE_PART('year', now())))
      `,
      [
      /*  $1 */ record.record_id,
        /*  $2 */ record.version_name,
        /*  $3 */ record.numerobio,
        /*  $4 */ record.certification_state,
        /*  $5 */ record.certification_date_debut,
        /*  $6 */ record.certification_date_fin,
        /*  $7 */ record.audit_date,
        /*  $8 */ record.audit_notes,
        /*  $9 */ record.audit_demandes,
        /* $10 */ JSON.stringify(record.audit_history),
        /* $11 */ record.metadata,
        /* $12 */ record.oc_id,
        /* $13 */ record.oc_label,
        /* $14 */ record.annee_reference_controle,
        /* $15 */ i
      ]
    )
  }

  if (pinnedRecords && pinnedRecords.length > 0) {
    for (let i = 0; i < pinnedRecords.length; i++) {
      await db.query(
        /* sql */`
        INSERT INTO operateurs_epingles (numerobio, user_id)
        VALUES ($1, $2)
        ON CONFLICT (numerobio, user_id) DO NOTHING`,
        [pinnedRecords[i], userId]
      )
    }
  }

  for (let i = 0; i < data.length; i++) {
    const record = data[i]
    for (let j = 0; j < parcelles.length; j++) {
      const parcelle: (typeof parcelles)[number] & { commentaire?: string } = parcelles[j]
      await db.query(
        /* sql */`
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures, created, conversion_niveau, engagement_date, numero_ilot_pac, numero_parcelle_pac, commentaire)
          VALUES
          ($1, $2, $3::geometry, $4, $5::jsonb, now() + ($11 ||' minutes')::INTERVAL, $6, $7, $8, $9, $10)
          `,
        [
          record.record_id,
          parcelle.id,
          parcelle.geometry,
          parcelle.commune,
          JSON.stringify(parcelle.cultures),
          parcelle.conversion_niveau,
          parcelle.engagement_date,
          parcelle.numero_ilot_pac,
          parcelle.numero_parcelle_pac,
          parcelle.commentaire,
          j
        ]
      )
    }
  }
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
