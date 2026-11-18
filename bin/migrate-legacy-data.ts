#!/usr/bin/env node

import 'dotenv/config'
import { join } from 'node:path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { ROOT_DIR } from '../src/shared/paths.js'

type Row = Record<string, unknown>

interface Step {
  table: string
  extract: string
  transform?: (row: Row) => Row | Row[] | null
}

const raw = (value: string): string => value
pg.types.setTypeParser(pg.types.builtins.DATE, raw)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, raw)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, raw)

const BATCH_SIZE = 500

const EVENT_TYPES: Record<string, string> = {
  CertificationStateChange: 'CERTIFICATION_STATE_CHANGE',
  FeatureCollectionCreation: 'FEATURE_COLLECTION_CREATE',
  FeatureCollectionDeletion: 'FEATURE_COLLECTION_DELETE',
  FeatureCollectionUpdate: 'FEATURE_COLLECTION_UPDATE',
  FeatureCreation: 'FEATURE_CREATE',
  FeatureDeletion: 'FEATURE_DELETE',
  FeatureUpdate: 'FEATURE_UPDATE'
}

const ANNOTATION_TYPES = ['DOWNGRADED', 'METADATA_STATE', 'REDUCED_CONVERSION_PERIOD', 'RISKY', 'SAMPLED', 'SURVEYED']

const geometry = (column: string): string =>
  `encode(ST_AsEWKB(ST_Multi(ST_CollectionExtract(ST_SetSRID(${column}, 4326), 3))), 'hex')`

const RECORDS = `(
  SELECT * FROM cartobio_operators
  ) o`

const PARCELLES = `(
  SELECT p.*,
    coalesce(p.created::timestamptz, o.created_at, now()) AS created_at,
    coalesce(p.updated::timestamptz, p.created::timestamptz, o.updated_at, now()) AS updated_at
  FROM cartobio_parcelles p
  JOIN ${RECORDS} USING (record_id)
  WHERE p.id <> '' AND NOT ST_IsEmpty(ST_CollectionExtract(p.geometry, 3))
) p`

const COMMUNES = `(
  SELECT * FROM communes
  WHERE length(code) <= 5 AND nom <> '' AND geometry IS NOT NULL
) c`

function clean(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') return null
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    const items = value.filter((item: string) => item.trim() !== '')
    return items.length > 0 ? items : null
  }
  return value
}

const cleanRow = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clean(value)]))

const matches = (value: unknown, pattern: RegExp): string | null =>
  typeof value === 'string' && pattern.test(value) ? value : null

const STEPS: Step[] = [
  {
    table: 'regions',
    extract: `SELECT code, nom, ${geometry('geometry')} AS geometry FROM region WHERE geometry IS NOT NULL`
  },
  {
    table: 'departements',
    extract: `SELECT code AS fid, nom, code_region, ${geometry('geometry')} AS geometry FROM departement WHERE geometry IS NOT NULL`
  },
  {
    table: 'communes',
    extract: `SELECT code AS fid, nom, coalesce(active, false) AS active, ${geometry('geometry')} AS geometry FROM ${COMMUNES}`
  },
  {
    table: 'territoires',
    extract: `SELECT fid::text AS fid, ${geometry('geom')} AS geom FROM territoires WHERE geom IS NOT NULL`
  },
  {
    table: 'organisme_certificateur',
    extract: `
      SELECT id::text AS id, label, emails AS email, active FROM organisme_certificateur
      UNION ALL (
        SELECT DISTINCT ON (oc_id) oc_id::text, coalesce(NULLIF(oc_label, ''), oc_id::text), NULL, true
        FROM cartobio_operators
        WHERE oc_id IS NOT NULL AND oc_id NOT IN (SELECT id FROM organisme_certificateur)
        ORDER BY oc_id, updated_at DESC NULLS LAST
      )
    `
  },
  {
    table: 'parcellaires',
    extract: `
      SELECT record_id, numerobio::int AS numerobio,
        coalesce(oc_id, (
          SELECT o2.oc_id FROM cartobio_operators o2
          WHERE o2.numerobio = o.numerobio AND o2.oc_id IS NOT NULL
          ORDER BY o2.updated_at DESC NULLS LAST LIMIT 1
        ))::text AS oc_id,
        certification_state AS certification_etat, certification_date_debut, certification_date_fin,
        audit_date, annee_reference_controle, audit_notes AS audit_notes_certif,
        audit_demandes AS audit_demandes_operateur, version_name AS version_nom, mixite,
        coalesce(created_at, updated_at, now()) AS created_at,
        coalesce(updated_at, created_at, now()) AS updated_at,
        date_derniere_notif::timestamptz AS date_derniere_notif,
        deleted_at::timestamptz AS deleted_at
      FROM ${RECORDS}
    `,
    transform: (record) => ({ ...record, certification_etat: record.certification_etat ?? 'OPERATOR_DRAFT' })
  },
  {
    table: 'parcellaires_metadata',
    extract: `SELECT record_id, coalesce(created_at, now()) AS created_at, metadata FROM ${RECORDS}`,
    transform: ({ record_id: recordId, created_at: createdAt, metadata }) => {
      const meta = cleanRow((metadata ?? {}) as Row)
      if (
        [meta.source, meta.provenance, meta.campagne, meta.pacage, meta.anneeAssolement].every((value) => value == null)
      )
        return null
      return {
        record_id: recordId,
        source: meta.source,
        source_updated_at: meta.sourceLastUpdate ?? createdAt,
        provenance: meta.provenance,
        campagne: matches(String(meta.campagne ?? ''), /^\d{4}$/),
        numero_pacage: meta.pacage,
        annee_assolement: matches(String(meta.anneeAssolement ?? ''), /^\d{4}$/)
      }
    }
  },
  {
    table: 'parcellaires_evenements',
    extract: `SELECT record_id, certification_state, coalesce(created_at, now()) AS created_at, audit_history FROM ${RECORDS}`,
    transform: ({
      record_id: recordId,
      certification_state: certificationState,
      created_at: createdAt,
      audit_history: history
    }) => {
      let etat: unknown = null
      return ((history ?? []) as Row[]).map(cleanRow).flatMap((event) => {
        const type = EVENT_TYPES[String(event.type)]
        if (type === undefined) return []
        etat = event.state ?? etat ?? certificationState ?? 'OPERATOR_DRAFT'
        const user = (event.user ?? {}) as Row
        return {
          record_id: recordId,
          type,
          certification_etat: etat,
          date: event.date ?? createdAt,
          user_id: user.id,
          user_role: (user.mainGroup as Row | undefined)?.nom,
          parcelles_id: event.featureIds
        }
      })
    }
  },
  {
    table: 'parcelles',
    extract: `
      SELECT record_id, id,
        CASE WHEN commune IN (SELECT code FROM ${COMMUNES}) THEN commune END AS commune,
        encode(ST_AsEWKB(largest.polygon), 'hex') AS geometry,
        round((ST_Area(largest.polygon::geography) / 10000)::numeric, 4) AS surface_ha,
        conversion_niveau, engagement_date, commentaire AS commentaire_operateur,
        auditeur_notes AS auditeur_notes_parcelles, from_parcelles, name, numero_pacage, numero_ilot_pac,
        numero_parcelle_pac AS numero_parcelles_pac, reference_cadastre, code_culture_pac, code_precision_pac,
        coalesce(etranger, false) AS etranger, statut_import_geom::text AS statut_import_geom, attente_pac,
        created_at, updated_at, deleted_at::timestamptz AS deleted_at
      FROM ${PARCELLES}
      CROSS JOIN LATERAL (
        SELECT part.geom AS polygon
        FROM ST_Dump(ST_CollectionExtract(ST_SetSRID(p.geometry, 4326), 3)) part
        ORDER BY ST_Area(part.geom::geography) DESC
        LIMIT 1
      ) largest
    `,
    transform: (parcelle) => ({
      ...parcelle,
      numero_pacage: matches(parcelle.numero_pacage, /^\d{1,9}$/),
      numero_ilot_pac: matches(parcelle.numero_ilot_pac, /^\d{1,4}$/),
      numero_parcelles_pac: matches(parcelle.numero_parcelles_pac, /^\d{1,4}$/),
      statut_import_geom:
        parcelle.statut_import_geom === 'ACCEPTENONCORRIGE' ? 'ACCEPTE_NON_CORRIGE' : parcelle.statut_import_geom
    })
  },
  {
    table: 'parcelle_cultures',
    extract: `SELECT record_id, id, cultures FROM ${PARCELLES}`,
    transform: ({ record_id: recordId, id, cultures }) =>
      ((cultures ?? []) as Row[])
        .map(cleanRow)
        .filter((culture) => culture.CPF != null || culture.TYPE != null)
        .map((culture) => ({
          record_id: recordId,
          parcelle_id: id,
          cpf: culture.CPF,
          code_culture_import: culture.TYPE,
          surface: matches(String(culture.surface ?? '').replace(',', '.'), /^\d+(\.\d+)?$/),
          unit: culture.unit,
          variete: culture.variete,
          date_semis: matches(culture.date_semis, /^\d{4}-\d{2}-\d{2}$/)
        }))
  },
  {
    table: 'parcelles_annotations',
    extract: `SELECT record_id, id, updated_at::date::text AS updated_at, annotations FROM ${PARCELLES}`,
    transform: ({ record_id: recordId, id, updated_at: updatedAt, annotations }) =>
      ((annotations ?? []) as Row[])
        .filter((annotation) => ANNOTATION_TYPES.includes(String(annotation.code)))
        .map((annotation) => ({
          record_id: recordId,
          parcelle_id: id,
          type_annot: annotation.code,
          created_at: matches(String(annotation.date ?? '').slice(0, 10), /^\d{4}-\d{2}-\d{2}$/) ?? updatedAt
        }))
  },
  {
    table: 'attestations_production',
    extract: `
      SELECT a.record_id, a.path, a.status, a.type,
        coalesce(a.created_at, now()) AS created_at,
        coalesce(a.updated_at, a.created_at, now()) AS updated_at
      FROM attestations_productions a JOIN ${RECORDS} USING (record_id)
    `,
    transform: (attestation) => ({
      ...attestation,
      type: attestation.type === 'complet' ? 'complete' : attestation.type
    })
  },
  ...['consultes', 'epingles'].map((name): Step => ({
    table: `parcellaires_${name}`,
    extract: `
      SELECT DISTINCT ON (r.record_id, x.user_id) r.record_id, x.user_id::text AS user_id, coalesce(x.created_at, now()) AS created_at
      FROM operateurs_${name} x
      JOIN LATERAL (
        SELECT record_id FROM ${RECORDS}
        WHERE o.numerobio = x.numerobio::text AND o.deleted_at IS NULL
        ORDER BY o.created_at DESC NULLS LAST LIMIT 1
      ) r ON true
    `
  })),
  {
    table: 'parcelles_controles',
    extract: `
      SELECT c.record_id, c.id AS parcelle_id, c.user_id::text AS user_id, c.created_at
      FROM parcelles_controlees c
      JOIN ${PARCELLES} ON p.record_id = c.record_id AND p.id = c.id
    `
  },
  {
    table: 'parcellaires_import',
    extract: `
      SELECT id, status, organisme_certificateur,
        coalesce(created_at::timestamptz, now()) AS created_at,
        started_at::timestamptz AS started_at, ended_at::timestamptz AS ended_at,
        numerobio, numeroclient, audit_date,
        result_job, statut_job::text AS statut_job, etat::text AS etat
      FROM parcellaire_import
    `
  },
  {
    table: 'parcellaire_import_logs',
    extract: `
      SELECT import_id, type, message, numero_bio, code, parcelle_id, parcelle_name
      FROM parcellaire_import_logs WHERE message <> ''
    `,
    transform: (log) => ({ ...log, code: log.code ?? 'UNKNOWN' })
  },
  {
    table: 'parcellaire_import_payload',
    extract: 'SELECT id::text AS id, import_id, payload FROM parcellaire_import_payload'
  },
  {
    table: 'import_pac',
    extract: `
      SELECT numerobio, pacage, siret, nb_parcelles, size, record, imported,
        coalesce(createdat::timestamptz, now()) AS created_at,
        coalesce(updatedat::timestamptz, createdat::timestamptz, now()) AS updated_at
      FROM import_pac_26
    `,
    transform: (pac) => ({ ...pac, siret: String(pac.siret ?? '').length <= 14 ? pac.siret : null })
  },
  {
    table: 'revoked_tokens',
    extract: 'SELECT rtrim(token_hash) AS token_hash, user_id, expires_at FROM revoked_tokens'
  }
]

function progress(table: string, done: number, total: number): void {
  const ratio = total === 0 ? 1 : done / total
  const bar = '█'.repeat(Math.round(ratio * 30)).padEnd(30, '░')
  process.stdout.write(
    `\r  ${table.padEnd(26)} ${bar} ${String(Math.round(ratio * 100)).padStart(3)}%  ${done}/${total}`
  )
}

async function load(target: pg.Client, table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return
  const columns = Object.keys(rows[0])
    .map((column) => `"${column}"`)
    .join(', ')
  await target.query(
    `INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM json_populate_recordset(null::"${table}", $1)`,
    [JSON.stringify(rows)]
  )
}

async function run(source: pg.Client, target: pg.Client, step: Step): Promise<Row> {
  const start = Date.now()
  const {
    rows: [{ total }]
  } = await source.query(`SELECT count(*)::int AS total FROM (${step.extract}) extract`)
  let read = 0
  let written = 0

  await source.query(`DECLARE extract NO SCROLL CURSOR FOR ${step.extract}`)
  progress(step.table, 0, total)
  while (true) {
    const { rows } = await source.query<Row>(`FETCH ${BATCH_SIZE} FROM extract`)
    if (rows.length === 0) break
    const transformed = rows
      .map(cleanRow)
      .flatMap((row): Row[] => [(step.transform ? step.transform(row) : row) ?? []].flat())
      .map(cleanRow)
    await load(target, step.table, transformed)
    read += rows.length
    written += transformed.length
    progress(step.table, read, total)
  }
  await source.query('CLOSE extract')
  process.stdout.write('\n')

  return { table: step.table, lues: read, écrites: written, durée: `${((Date.now() - start) / 1000).toFixed(1)} s` }
}

async function main(): Promise<void> {
  const sourceUrl = process.env.SOURCE_DATABASE_URL
  const targetUrl = process.env.TARGET_DATABASE_URL
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL et TARGET_DATABASE_URL sont obligatoires')

  const source = new pg.Client({ connectionString: sourceUrl })
  const target = new pg.Client({ connectionString: targetUrl, options: '-c search_path=cartobio,public' })
  await source.connect()
  await target.connect()

  try {
    if (process.argv.includes('--reset')) {
      await target.query(`TRUNCATE ${STEPS.map(({ table }) => `"${table}"`).join(', ')} CASCADE`)
    } else if ((await target.query('SELECT 1 FROM parcellaires LIMIT 1')).rowCount !== 0) {
      throw new Error('La base cible contient déjà des données, relancer avec --reset pour la vider')
    }

    console.log('Copie des données…')
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await target.query('BEGIN')
    const report: Row[] = []
    for (const step of STEPS) report.push(await run(source, target, step))
    await target.query(
      "SELECT setval(pg_get_serial_sequence('parcellaires_import', 'id'), coalesce(max(id), 0) + 1, false) FROM parcellaires_import"
    )
    await target.query('COMMIT')
    await source.query('COMMIT')

    console.table(report)
  } catch (error) {
    await target.query('ROLLBACK')
    throw error
  } finally {
    await source.end()
    await target.end()
  }
}

main().catch((error: unknown): void => {
  process.stdout.write('\n')
  console.error(error)
  process.exitCode = 1
})
