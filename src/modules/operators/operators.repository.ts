import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { toIsoDateTime } from '@agencebio/cartobio-types'
import type { AgenceBioNormalizedOperator } from '@agencebio/cartobio-types'
import { db } from '../../database/database.js'
import {
  importPac,
  operateursConsultes,
  operateursEpingles,
  parcellaires,
  parcellairesEvenements,
  parcellairesMetadata
} from '../../database/schema/index.js'
import { createOperateurConsulteSchema, createOperateurEpingleSchema } from '../../database/validations/activites.js'
import { updateImportPacSchema } from '../../database/validations/imports.js'
import { certificationEtatEnumSchema } from '../../database/validations/parcellaires.js'
import { isoDay, recordMetadata } from '../../shared/parcellaires/parcellaires.utils.js'
import type { SQL } from 'drizzle-orm'
import { numerosBioEntiers } from './operators.utils.js'
import type {
  DashboardStateRow,
  ImportPacRow,
  NumeroBio,
  OperatorRecordRow,
  OperatorWithRecordData,
  AgenceBioNormalizedOperatorWithFilterData
} from './operators.types.js'

const dateReference = sql`COALESCE(${parcellaires.certificationDateDebut}, ${parcellaires.auditDate}, ${parcellaires.createdAt})`

const recordFields = {
  certification_state: parcellaires.certificationEtat,
  audit_date: isoDay(parcellaires.auditDate),
  certification_date_debut: isoDay(parcellaires.certificationDateDebut),
  created_at: parcellaires.createdAt,
  numerobio: sql<string>`${parcellaires.numeroBio}::text`,
  metadata: recordMetadata,
  record_id: parcellaires.recordId,
  updated_at: parcellaires.updatedAt,
  annee_reference_controle: parcellaires.anneeReferenceControle,
  version_name: parcellaires.versionNom,
  user_id: sql<string | null>`(
    SELECT ${parcellairesEvenements.userId}
    FROM ${parcellairesEvenements}
    WHERE ${eq(parcellairesEvenements.recordId, parcellaires.recordId)}
    ORDER BY ${parcellairesEvenements.date} DESC
    LIMIT 1
  )`,
  user_role: sql<string | null>`(
    SELECT ${parcellairesEvenements.userRole}
    FROM ${parcellairesEvenements}
    WHERE ${eq(parcellairesEvenements.recordId, parcellaires.recordId)}
    ORDER BY ${parcellairesEvenements.date} DESC
    LIMIT 1
  )`
}

async function findFilterData(
  operators: AgenceBioNormalizedOperator[],
  mixite = false
): Promise<AgenceBioNormalizedOperatorWithFilterData[]> {
  const ids = numerosBioEntiers(operators.map(({ numeroBio }) => numeroBio))

  if (ids.length === 0) {
    return []
  }

  const allParcellaire = db.$with('all_parcellaire').as(
    db
      .select({
        numerobio: sql<string>`${parcellaires.numeroBio}::text`.as('numerobio'),
        states: sql<
          Array<{ certification_state: string; annee_reference_controle: number }>
        >`JSON_AGG(JSON_BUILD_OBJECT('certification_state', ${parcellaires.certificationEtat}, 'annee_reference_controle', ${parcellaires.anneeReferenceControle}))`.as(
          'states'
        ),
        list_oc_id: sql<number[]>`JSON_AGG(${parcellaires.ocId})`.as('list_oc_id'),
        max_audit_date: max(parcellaires.auditDate).as('max_audit_date')
      })
      .from(parcellaires)
      .where(and(inArray(parcellaires.numeroBio, ids), isNull(parcellaires.deletedAt)))
      .groupBy(parcellaires.numeroBio)
  )

  const lastCertifiedParcelle = db.$with('last_certified_parcelle').as(
    db
      .selectDistinctOn([parcellaires.numeroBio], {
        numerobio: sql<string>`${parcellaires.numeroBio}::text`.as('numerobio'),
        lastmixitestate: parcellaires.mixite
      })
      .from(parcellaires)
      .where(
        and(
          inArray(parcellaires.numeroBio, ids),
          eq(parcellaires.certificationEtat, certificationEtatEnumSchema.enum.CERTIFIED),
          isNull(parcellaires.deletedAt)
        )
      )
      .orderBy(parcellaires.numeroBio, sql`${parcellaires.certificationDateDebut} DESC NULLS LAST`)
  )

  const rows: Array<Partial<AgenceBioNormalizedOperatorWithFilterData> & { numerobio: string }> = mixite
    ? await db
        .with(allParcellaire, lastCertifiedParcelle)
        .select({
          lastmixitestate: lastCertifiedParcelle.lastmixitestate,
          numerobio: allParcellaire.numerobio,
          states: allParcellaire.states,
          list_oc_id: allParcellaire.list_oc_id,
          max_audit_date: allParcellaire.max_audit_date
        })
        .from(allParcellaire)
        .leftJoin(lastCertifiedParcelle, eq(allParcellaire.numerobio, lastCertifiedParcelle.numerobio))
        .orderBy(sql`${allParcellaire.numerobio}::bigint ASC`)
    : await db
        .with(allParcellaire)
        .select()
        .from(allParcellaire)
        .orderBy(sql`${allParcellaire.numerobio}::bigint ASC`)

  const rowsByNumeroBio = new Map(rows.map((row) => [Number(row.numerobio), row]))

  return operators
    .toSorted((a, b) => +a.numeroBio - +b.numeroBio)
    .map((operator) => {
      const row = rowsByNumeroBio.get(Number(operator.numeroBio))
      if (!row) return { ...operator, metadata: {} }

      const { metadata, ...record } = row
      return { ...operator, metadata: metadata ?? {}, ...record }
    })
}

async function findRecordData(operateur: AgenceBioNormalizedOperator): Promise<OperatorWithRecordData> {
  const [numeroBio] = numerosBioEntiers([operateur.numeroBio])

  if (numeroBio === undefined) {
    return { ...operateur, metadata: {} }
  }

  const operateurRecords = and(eq(parcellaires.numeroBio, numeroBio), isNull(parcellaires.deletedAt))

  const latestRecord = (...conditions: SQL[]): Promise<OperatorRecordRow[]> =>
    db
      .select(recordFields)
      .from(parcellaires)
      .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
      .where(and(operateurRecords, ...conditions))
      .orderBy(desc(dateReference))
      .limit(1)

  const [latestByState, latestGlobal, [lastCertifiedParcelle]] = await Promise.all([
    latestRecord(
      inArray(parcellaires.certificationEtat, [
        certificationEtatEnumSchema.enum.AUDITED,
        certificationEtatEnumSchema.enum.PENDING_CERTIFICATION,
        certificationEtatEnumSchema.enum.CERTIFIED
      ])
    ),
    latestRecord(),
    db
      .select({
        lastcertifieddate: parcellaires.anneeReferenceControle,
        lastmixitestate: parcellaires.mixite
      })
      .from(parcellaires)
      .where(and(operateurRecords, eq(parcellaires.certificationEtat, certificationEtatEnumSchema.enum.CERTIFIED)))
      .orderBy(sql`${parcellaires.certificationDateDebut} DESC NULLS LAST`)
      .limit(1)
  ])

  const matchingRows = [...latestByState, ...latestGlobal]
    .filter((row, index, all) => all.findIndex(({ record_id: recordId }) => recordId === row.record_id) === index)
    .map((row) => ({
      ...row,
      created_at: toIsoDateTime(row.created_at),
      updated_at: toIsoDateTime(row.updated_at),
      lastcertifieddate: lastCertifiedParcelle?.lastcertifieddate ?? null,
      lastmixitestate: lastCertifiedParcelle?.lastmixitestate ?? null
    }))

  matchingRows.sort((a, b) => {
    return (
      +(a.certification_state === certificationEtatEnumSchema.enum.OPERATOR_DRAFT) -
      +(b.certification_state === certificationEtatEnumSchema.enum.OPERATOR_DRAFT)
    )
  })
  const [primaryRecord, ...otherRecords] = matchingRows
  if (!primaryRecord) {
    return { ...operateur, metadata: {} }
  }
  const { metadata, ...record } = primaryRecord

  return {
    ...operateur,
    metadata,
    ...record,
    otherParcellaire: otherRecords.length > 0 ? otherRecords : null
  }
}

async function findConsultedOperators(userId: number): Promise<number[]> {
  const rows = await db
    .select({ numerobio: operateursConsultes.numeroBio })
    .from(operateursConsultes)
    .where(eq(operateursConsultes.userId, String(userId)))
    .orderBy(desc(operateursConsultes.createdAt))
    .limit(10)

  return rows.map((r) => r.numerobio)
}

async function insertPinnedOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await db
    .insert(operateursEpingles)
    .values(createOperateurEpingleSchema.parse({ numeroBio: Number(numeroBio), userId: String(userId) }))
    .onConflictDoNothing({ target: [operateursEpingles.numeroBio, operateursEpingles.userId] })
}

async function deletePinnedOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await db
    .delete(operateursEpingles)
    .where(and(eq(operateursEpingles.numeroBio, Number(numeroBio)), eq(operateursEpingles.userId, String(userId))))
}

async function upsertConsultedOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await db
    .insert(operateursConsultes)
    .values(createOperateurConsulteSchema.parse({ numeroBio: Number(numeroBio), userId: String(userId) }))
    .onConflictDoUpdate({
      target: [operateursConsultes.numeroBio, operateursConsultes.userId],
      set: { createdAt: sql`now()` }
    })
}

async function findImportPac(numeroBio: NumeroBio): Promise<ImportPacRow | null> {
  const [row] = await db
    .select({
      size: importPac.size,
      nb_parcelles: importPac.nbParcelles,
      pacage: importPac.pacage,
      imported: importPac.imported,
      record: importPac.record
    })
    .from(importPac)
    .where(eq(importPac.numeroBio, String(numeroBio)))
    .limit(1)

  return row ?? null
}

async function updateImportPacImported(numeroBio: NumeroBio): Promise<void> {
  await db
    .update(importPac)
    .set(updateImportPacSchema.parse({ imported: true }))
    .where(eq(importPac.numeroBio, String(numeroBio)))
}

async function findPinnedOperators(userId: number): Promise<number[]> {
  const rows = await db
    .select({ numerobio: operateursEpingles.numeroBio })
    .from(operateursEpingles)
    .where(eq(operateursEpingles.userId, String(userId)))
    .orderBy(desc(operateursEpingles.createdAt))

  return rows.map(({ numerobio }) => numerobio)
}

async function findDashboardStates(numeroBios: string[], anneeReferenceControle: number): Promise<DashboardStateRow[]> {
  const certifie = sql<boolean>`(${eq(parcellaires.certificationEtat, certificationEtatEnumSchema.enum.CERTIFIED)})`

  return db
    .select({
      certifie,
      numerobios: sql<string[]>`JSON_AGG(DISTINCT ${parcellaires.numeroBio}::text)`
    })
    .from(parcellaires)
    .where(
      and(
        inArray(parcellaires.numeroBio, numerosBioEntiers(numeroBios)),
        isNull(parcellaires.deletedAt),
        eq(parcellaires.anneeReferenceControle, anneeReferenceControle),
        inArray(parcellaires.certificationEtat, [
          certificationEtatEnumSchema.enum.AUDITED,
          certificationEtatEnumSchema.enum.PENDING_CERTIFICATION,
          certificationEtatEnumSchema.enum.CERTIFIED
        ])
      )
    )
    .groupBy(sql`1`)
}
export {
  insertPinnedOperator,
  deletePinnedOperator,
  upsertConsultedOperator,
  findImportPac,
  updateImportPacImported,
  findPinnedOperators,
  findDashboardStates,
  findConsultedOperators,
  findFilterData,
  findRecordData
}
