#!/usr/bin/env node

import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import pg from 'pg'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { annotationCodes, isAnnotationCode } from '../src/database/validations/parcelles.js'
import { eventTypes } from '../src/shared/parcellaires/parcellaires.utils.js'
import { scriptOutputPath } from '../src/shared/paths.js'

type Row = Record<string, unknown>
type Db = NodePgDatabase & { $client: pg.Client }

interface Step {
  table: string
  extract: string
  transform?: (row: Row) => Row | Row[] | null
  parentKey?: { column: string; childColumn: string }
}

const skippedParents = new Map<string, Set<string>>()

const raw = (value: string): string => value
pg.types.setTypeParser(pg.types.builtins.DATE, raw)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, raw)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, raw)

const BATCH_SIZE = 500

const geometry = (column: string): string =>
  `encode(ST_AsEWKB(ST_Multi(ST_CollectionExtract(ST_SetSRID(${column}, 4326), 3))), 'hex')`

const RECORDS = 'cartobio_operators o'

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const uniqueId = (value: unknown, seen: Set<string>, pattern = /^.+$/): string => {
  const id = matches(String(value ?? ''), pattern) && !seen.has(String(value)) ? String(value) : randomUUID()
  seen.add(id)
  return id
}

const metadataSources: Record<string, string> = {
  telepac: 'TELEPAC',
  'api parcellaire': 'API_PARCELLAIRE',
  anygeo: 'ANYGEO',
  geofolia: 'GEOFOLIA',
  mesparcelles: 'MES_PARCELLES',
  cvi: 'CVI',
  rpg: 'RPG',
  manuel: 'MANUEL',
  'copie de version existante': 'COPIE_VERSION',
  'copie lors de la résolution de conflits': 'COPIE_CONFLIT'
}

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
    extract: `SELECT fid::text AS fid, ${geometry('geom')} AS geometry FROM territoires WHERE geom IS NOT NULL`
  },
  {
    table: 'organisme_certificateur',
    extract: `
      SELECT id, label, emails AS email, active FROM organisme_certificateur
      UNION ALL (
        SELECT DISTINCT ON (oc_id) oc_id, coalesce(NULLIF(oc_label, ''), oc_id::text), NULL, true
        FROM cartobio_operators
        WHERE oc_id IS NOT NULL AND oc_id NOT IN (SELECT id FROM organisme_certificateur)
        ORDER BY oc_id, updated_at DESC NULLS LAST
      )
    `
  },
  {
    table: 'parcellaires',
    extract: `
      SELECT record_id, numerobio::int AS numero_bio,
        coalesce(oc_id, (
          SELECT o2.oc_id FROM cartobio_operators o2
          WHERE o2.numerobio = o.numerobio AND o2.oc_id IS NOT NULL
          ORDER BY o2.updated_at DESC NULLS LAST LIMIT 1
        )) AS oc_id,
        certification_state AS certification_etat, certification_date_debut, certification_date_fin,
        audit_date, annee_reference_controle, audit_notes AS audit_notes_certif,
        audit_demandes AS audit_demandes_operateur, version_name AS version_nom, mixite,
        coalesce(created_at, updated_at, now()) AS created_at,
        coalesce(updated_at, created_at, now()) AS updated_at,
        date_derniere_notif::timestamptz AS date_derniere_notif,
        deleted_at::timestamptz AS deleted_at
      FROM ${RECORDS}
    `,
    transform: (record) => ({
      ...record,
      certification_etat: record.certification_etat ?? 'OPERATOR_DRAFT'
    }),
    parentKey: { column: 'record_id', childColumn: 'record_id' }
  },
  {
    table: 'parcellaires_metadata',
    extract: `SELECT record_id, metadata FROM ${RECORDS}`,
    transform: ({ record_id: recordId, metadata }) => {
      const meta = cleanRow((metadata ?? {}) as Row)
      if (
        [
          meta.source,
          meta.provenance,
          meta.campagne,
          meta.pacage,
          meta.anneeAssolement,
          meta.sourceLastUpdate,
          meta.copy_of,
          meta.warnings
        ].every((value) => value == null)
      )
        return null
      return {
        record_id: recordId,
        source:
          metadataSources[
            String(meta.source ?? '')
              .trim()
              .toLowerCase()
          ] ?? null,
        source_updated_at: meta.sourceLastUpdate,
        provenance: meta.provenance,
        campagne: matches(String(meta.campagne ?? ''), /^\d{4}$/),
        numero_pacage: meta.pacage,
        annee_assolement: matches(String(meta.anneeAssolement ?? ''), /^\d{4}$/),
        copy_of: meta.copy_of,
        warnings: meta.warnings
      }
    }
  },
  {
    table: 'parcellaires_evenements',
    extract: `SELECT record_id, coalesce(created_at, now()) AS created_at, audit_history FROM ${RECORDS}`,
    transform: ({ record_id: recordId, created_at: createdAt, audit_history: history }) =>
      ((history ?? []) as Row[]).map(cleanRow).flatMap((event) => {
        const type = eventTypes[String(event.type)]
        if (type === undefined) return []
        const user = (event.user ?? {}) as Row
        return {
          record_id: recordId,
          type,
          certification_etat: event.state,
          date: event.date ?? createdAt,
          user_id: user.id,
          user_role: (user.mainGroup as Row | undefined)?.nom,
          parcelles_id: event.featureIds,
          description: event.description,
          metadata: event.metadata
        }
      })
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
    transform: ({ record_id: recordId, id, cultures }) => {
      const seen = new Set<string>()
      return ((cultures ?? []) as Row[]).map(cleanRow).map((culture, position) => ({
        id: uniqueId(culture.id, seen),
        record_id: recordId,
        parcelle_id: id,
        cpf: culture.CPF,
        code_culture_import: culture.TYPE,
        surface: matches(String(culture.surface ?? '').replace(',', '.'), /^\d+(\.\d+)?$/),
        unit: culture.unit,
        variete: culture.variete,
        date_semis: matches(culture.date_semis, /^\d{4}-\d{2}-\d{2}$/),
        commentaire: culture.commentaire,
        position
      }))
    }
  },
  {
    table: 'parcelles_annotations',
    extract: `SELECT record_id, id, updated_at, annotations FROM ${PARCELLES}`,
    transform: ({ record_id: recordId, id, updated_at: updatedAt, annotations }) => {
      const seen = new Set<string>()
      return ((annotations ?? []) as Row[]).flatMap((annotation) => {
        const code = String(annotation.code)
        if (!isAnnotationCode(code)) return []

        return [
          {
            id: uniqueId(annotation.id, seen, UUID),
            record_id: recordId,
            parcelle_id: id,
            type_annot: annotationCodes[code],
            created_at: annotation.date ?? updatedAt,
            metadata: annotation.metadata
          }
        ]
      })
    }
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
    table: `operateurs_${name}`,
    extract: `SELECT numerobio::int AS numero_bio, user_id::text AS user_id, coalesce(created_at, now()) AS created_at FROM operateurs_${name}`
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
    table: 'parcellaire_import',
    extract: `
      SELECT id, status, organisme_certificateur::int AS organisme_certificateur,
        coalesce(created_at::timestamptz, now()) AS created_at,
        started_at::timestamptz AS started_at, ended_at::timestamptz AS ended_at,
        numerobio AS numero_bio, numeroclient AS numero_client, audit_date,
        result_job, statut_job::text AS statut_job, etat::text AS etat
      FROM parcellaire_import
    `,
    parentKey: { column: 'id', childColumn: 'import_id' }
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
      SELECT numerobio AS numero_bio, pacage, siret, nb_parcelles, size, record, imported,
        coalesce(createdat::timestamptz, now()) AS created_at,
        coalesce(updatedat::timestamptz, createdat::timestamptz, now()) AS updated_at
      FROM import_pac_26
    `,
    transform: (pac) => ({
      ...pac,
      siret: String(pac.siret ?? '').length <= 14 ? pac.siret : null,
      nb_parcelles: /^\d+$/.test(String(pac.nb_parcelles ?? '')) ? Number(pac.nb_parcelles) : null,
      size: /^\d+(\.\d+)?$/.test(String(pac.size ?? '')) ? Number(pac.size) : null
    })
  }
]

function progress(table: string, done: number, total: number): void {
  const ratio = total === 0 ? 1 : done / total
  const bar = '█'.repeat(Math.round(ratio * 30)).padEnd(30, '░')
  process.stdout.write(
    `\r  ${table.padEnd(26)} ${bar} ${String(Math.round(ratio * 100)).padStart(3)}%  ${done}/${total}`
  )
}

async function load(target: Db, step: Step, rows: Row[]): Promise<number> {
  const [first] = rows
  if (!first) return 0
  const columns = Object.keys(first)
    .map((column) => `"${column}"`)
    .join(', ')
  const key = step.parentKey
  const result = await target.execute<Row>(
    sql`INSERT INTO ${sql.identifier(step.table)} (${sql.raw(columns)}) SELECT ${sql.raw(columns)} FROM json_populate_recordset(null::${sql.identifier(step.table)}, ${JSON.stringify(rows)}) ON CONFLICT DO NOTHING ${key ? sql`RETURNING ${sql.identifier(key.column)}` : sql``}`
  )
  if (key) {
    const inserted = new Set(result.rows.map((row) => String(row[key.column])))
    const skipped = skippedParents.get(key.childColumn) ?? new Set<string>()
    for (const row of rows) if (!inserted.has(String(row[key.column]))) skipped.add(String(row[key.column]))
    skippedParents.set(key.childColumn, skipped)
  }
  return result.rowCount ?? 0
}

const hasSkippedParent = (row: Row): boolean =>
  [...skippedParents].some(([column, values]) => column in row && values.has(String(row[column])))

async function run(source: Db, target: Db, step: Step): Promise<Row> {
  const start = Date.now()
  const {
    rows: [{ total } = { total: 0 }]
  } = await source.execute<{ total: number }>(`SELECT count(*)::int AS total FROM (${step.extract}) extract`)
  let read = 0
  let written = 0

  await source.execute(`DECLARE extract NO SCROLL CURSOR FOR ${step.extract}`)
  progress(step.table, 0, total)
  while (true) {
    const { rows } = await source.execute<Row>(`FETCH ${BATCH_SIZE} FROM extract`)
    if (rows.length === 0) break
    const transformed = rows
      .map(cleanRow)
      .flatMap((row): Row[] => [(step.transform ? step.transform(row) : row) ?? []].flat())
      .map(cleanRow)
      .filter((row) => !hasSkippedParent(row))
    read += rows.length
    written += await load(target, step, transformed)
    progress(step.table, read, total)
  }
  await source.execute('CLOSE extract')
  process.stdout.write('\n')

  return {
    table: step.table,
    lues: read,
    écrites: written,
    durée: `${((Date.now() - start) / 1000).toFixed(1)} s`
  }
}

async function lossReport(source: Db): Promise<Row[]> {
  const checks: Array<[string, string]> = [
    [
      'parcelles sans id ou sans polygone (ignorées)',
      "p.id = '' OR p.geometry IS NULL OR ST_IsEmpty(ST_CollectionExtract(p.geometry, 3))"
    ],
    [
      'parcelles multi-polygones (plus grand polygone conservé)',
      'ST_NumGeometries(ST_CollectionExtract(p.geometry, 3)) > 1'
    ],
    ["numéros d'îlot PAC invalides (mis à NULL)", "nullif(p.numero_ilot_pac::text, '') !~ '^\\d{1,4}$'"],
    ['numéros de parcelle PAC invalides (mis à NULL)', "nullif(p.numero_parcelle_pac::text, '') !~ '^\\d{1,4}$'"],
    ['numéros PACAGE invalides (mis à NULL)', "nullif(p.numero_pacage::text, '') !~ '^\\d{1,9}$'"]
  ]
  return Promise.all(
    checks.map(async ([perte, condition]) => {
      const {
        rows: [{ total } = { total: 0 }]
      } = await source.execute<{ total: number }>(
        `SELECT count(*)::int AS total FROM cartobio_parcelles p JOIN ${RECORDS} USING (record_id) WHERE ${condition}`
      )
      return { perte, lignes: total }
    })
  )
}

async function truncatedParcellesReport(source: Db): Promise<string | null> {
  const { rows } = await source.execute<Row>(`
    SELECT record_id, o.numerobio, p.id, ST_NumGeometries(polygons) AS polygones,
      round((ST_Area(polygons::geography) / 10000)::numeric, 4) AS surface_totale_ha,
      round((ST_Area(largest.polygon::geography) / 10000)::numeric, 4) AS surface_conservee_ha,
      round(((ST_Area(polygons::geography) - ST_Area(largest.polygon::geography)) / 10000)::numeric, 4) AS surface_perdue_ha
    FROM (SELECT p.*, ST_CollectionExtract(ST_SetSRID(p.geometry, 4326), 3) AS polygons FROM ${PARCELLES}) p
    JOIN ${RECORDS} USING (record_id)
    CROSS JOIN LATERAL (
      SELECT part.geom AS polygon
      FROM ST_Dump(p.polygons) part
      ORDER BY ST_Area(part.geom::geography) DESC
      LIMIT 1
    ) largest
    WHERE ST_NumGeometries(p.polygons) > 1
    ORDER BY surface_perdue_ha DESC
  `)
  const [first] = rows
  if (!first) return null
  const file = scriptOutputPath('migration-parcelles-tronquees.csv')
  const lines = [Object.keys(first), ...rows.map((row) => Object.values(row))].map((values) =>
    values.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')
  )
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 })
  return file
}

const sourceUrl = process.env.SOURCE_DATABASE_URL
const targetUrl = process.env.TARGET_DATABASE_URL
if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL et TARGET_DATABASE_URL sont obligatoires')

const source = drizzle({ client: new pg.Client({ connectionString: sourceUrl }) })
const target = drizzle({
  client: new pg.Client({
    connectionString: targetUrl,
    options: '-c search_path=cartobio,public'
  })
})
await source.$client.connect()
await target.$client.connect()

try {
  if (process.argv.includes('--reset')) {
    await target.execute(`TRUNCATE ${STEPS.map(({ table }) => `"${table}"`).join(', ')} CASCADE`)
  }

  console.log('Copie des données…')
  await source.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await target.execute('BEGIN')
  console.table(await lossReport(source))
  const truncatedFile = await truncatedParcellesReport(source)
  if (truncatedFile) console.log(`Parcelles multi-polygones tronquées : ${truncatedFile}`)
  const report: Row[] = []
  for (const step of STEPS) report.push(await run(source, target, step))
  await target.execute(
    "SELECT setval(pg_get_serial_sequence('parcellaire_import', 'id'), coalesce(max(id), 0) + 1, false) FROM parcellaire_import"
  )
  await target.execute('COMMIT')
  await source.execute('COMMIT')

  console.table(report)
} catch (error) {
  await target.execute('ROLLBACK')
  throw error
} finally {
  await source.$client.end()
  await target.$client.end()
}
