import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { toIsoDate, toIsoDateTime } from '@agencebio/cartobio-types'
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
import { recordMetadata } from '../../shared/parcellaires/parcellaires.utils.js'
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
  audit_date: parcellaires.auditDate,
  certification_date_debut: parcellaires.certificationDateDebut,
  created_at: parcellaires.createdAt,
  numerobio: parcellaires.numeroBio,
  metadata: recordMetadata,
  record_id: parcellaires.recordId,
  updated_at: parcellaires.updatedAt,
  annee_reference_controle: parcellaires.anneeReferenceControle,
  version_name: parcellaires.versionNom
}

async function findLastEventUsers(
  recordIds: string[]
): Promise<Map<string, { user_id: string | null; user_role: string | null }>> {
  if (recordIds.length === 0) return new Map()

  const rows = await db
    .selectDistinctOn([parcellairesEvenements.recordId], {
      recordId: parcellairesEvenements.recordId,
      user_id: parcellairesEvenements.userId,
      user_role: parcellairesEvenements.userRole
    })
    .from(parcellairesEvenements)
    .where(inArray(parcellairesEvenements.recordId, recordIds))
    .orderBy(parcellairesEvenements.recordId, desc(parcellairesEvenements.date))

  return new Map(rows.map(({ recordId, ...user }) => [recordId, user]))
}

type RecordFieldsRow = Omit<
  OperatorRecordRow,
  'audit_date' | 'certification_date_debut' | 'numerobio' | 'user_id' | 'user_role'
> & {
  audit_date: string | null
  certification_date_debut: string | null
  numerobio: number
}

function toOperatorRecordRow(
  row: RecordFieldsRow,
  users: Map<string, { user_id: string | null; user_role: string | null }>
): OperatorRecordRow {
  return {
    ...row,
    audit_date: row.audit_date === null ? null : toIsoDate(row.audit_date),
    certification_date_debut: row.certification_date_debut === null ? null : toIsoDate(row.certification_date_debut),
    numerobio: String(row.numerobio),
    user_id: users.get(row.record_id)?.user_id ?? null,
    user_role: users.get(row.record_id)?.user_role ?? null
  }
}

export async function findFilterData(
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
        numerobio: parcellaires.numeroBio,
        states: sql<
          Array<{ certification_state: string; annee_reference_controle: number }>
        >`JSON_AGG(JSON_BUILD_OBJECT('certification_state', ${parcellaires.certificationEtat}, 'annee_reference_controle', ${parcellaires.anneeReferenceControle}))`.as(
          'states'
        ),
        list_oc_id: sql<number[]>`JSON_AGG(${parcellaires.ocId})`.as('list_oc_id'),
        max_audit_date: max(parcellaires.auditDate).as('max_audit_date')
      })
      .from(parcellaires)
      .where(and(sql`${parcellaires.numeroBio} = ANY(${sql.param(ids)}::int[])`, isNull(parcellaires.deletedAt)))
      .groupBy(parcellaires.numeroBio)
  )

  const lastCertifiedParcelle = db.$with('last_certified_parcelle').as(
    db
      .selectDistinctOn([parcellaires.numeroBio], {
        numerobio: parcellaires.numeroBio,
        lastmixitestate: parcellaires.mixite
      })
      .from(parcellaires)
      .where(
        and(
          sql`${parcellaires.numeroBio} = ANY(${sql.param(ids)}::int[])`,
          eq(parcellaires.certificationEtat, certificationEtatEnumSchema.enum.CERTIFIED),
          isNull(parcellaires.deletedAt)
        )
      )
      .orderBy(parcellaires.numeroBio, sql`${parcellaires.certificationDateDebut} DESC NULLS LAST`)
  )

  const rows: Array<Partial<AgenceBioNormalizedOperatorWithFilterData> & { numerobio: number }> = mixite
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
        .orderBy(asc(allParcellaire.numerobio))
    : await db.with(allParcellaire).select().from(allParcellaire).orderBy(asc(allParcellaire.numerobio))

  const rowsByNumeroBio = new Map(rows.map((row) => [row.numerobio, { ...row, numerobio: String(row.numerobio) }]))

  return operators
    .toSorted((a, b) => +a.numeroBio - +b.numeroBio)
    .map((operator) => {
      const row = rowsByNumeroBio.get(Number(operator.numeroBio))
      if (!row) return { ...operator, metadata: {} }

      const { metadata, ...record } = row
      return { ...operator, metadata: metadata ?? {}, ...record }
    })
}

export async function findRecordData(operateur: AgenceBioNormalizedOperator): Promise<OperatorWithRecordData> {
  const [numeroBio] = numerosBioEntiers([operateur.numeroBio])

  if (numeroBio === undefined) {
    return { ...operateur, metadata: {} }
  }

  const operateurRecords = and(eq(parcellaires.numeroBio, numeroBio), isNull(parcellaires.deletedAt))

  const latestRecord = (...conditions: SQL[]): Promise<RecordFieldsRow[]> =>
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

  const uniqueRows = [...latestByState, ...latestGlobal].filter(
    (row, index, all) => all.findIndex(({ record_id: recordId }) => recordId === row.record_id) === index
  )
  const users = await findLastEventUsers(uniqueRows.map(({ record_id: recordId }) => recordId))
  const matchingRows = uniqueRows
    .map((row) => toOperatorRecordRow(row, users))
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

export async function findConsultedOperators(userId: number): Promise<number[]> {
  const rows = await db
    .select({ numerobio: operateursConsultes.numeroBio })
    .from(operateursConsultes)
    .where(eq(operateursConsultes.userId, String(userId)))
    .orderBy(desc(operateursConsultes.createdAt))
    .limit(10)

  return rows.map((r) => r.numerobio)
}

export async function insertPinnedOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await db
    .insert(operateursEpingles)
    .values(createOperateurEpingleSchema.parse({ numeroBio: Number(numeroBio), userId: String(userId) }))
    .onConflictDoNothing({ target: [operateursEpingles.numeroBio, operateursEpingles.userId] })
}

export async function deletePinnedOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await db
    .delete(operateursEpingles)
    .where(and(eq(operateursEpingles.numeroBio, Number(numeroBio)), eq(operateursEpingles.userId, String(userId))))
}

export async function upsertConsultedOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await db
    .insert(operateursConsultes)
    .values(createOperateurConsulteSchema.parse({ numeroBio: Number(numeroBio), userId: String(userId) }))
    .onConflictDoUpdate({
      target: [operateursConsultes.numeroBio, operateursConsultes.userId],
      set: { createdAt: new Date() }
    })
}

export async function findImportPac(numeroBio: NumeroBio): Promise<ImportPacRow | null> {
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

export async function updateImportPacImported(numeroBio: NumeroBio): Promise<void> {
  await db
    .update(importPac)
    .set(updateImportPacSchema.parse({ imported: true }))
    .where(eq(importPac.numeroBio, String(numeroBio)))
}

export async function findPinnedOperators(userId: number): Promise<number[]> {
  const rows = await db
    .select({ numerobio: operateursEpingles.numeroBio })
    .from(operateursEpingles)
    .where(eq(operateursEpingles.userId, String(userId)))
    .orderBy(desc(operateursEpingles.createdAt))

  return rows.map(({ numerobio }) => numerobio)
}

export async function findDashboardStates(
  numeroBios: string[],
  anneeReferenceControle: number
): Promise<DashboardStateRow[]> {
  const rows = await db
    .selectDistinct({ certificationEtat: parcellaires.certificationEtat, numeroBio: parcellaires.numeroBio })
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

  return [true, false].flatMap((certifie) => {
    const numerobios = [
      ...new Set(
        rows
          .filter(
            ({ certificationEtat }) => (certificationEtat === certificationEtatEnumSchema.enum.CERTIFIED) === certifie
          )
          .map(({ numeroBio }) => String(numeroBio))
      )
    ].sort()
    return numerobios.length > 0 ? [{ certifie, numerobios }] : []
  })
}
