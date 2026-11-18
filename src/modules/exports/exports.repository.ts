import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { db } from '../../database/database.js'
import {
  attestationsProduction,
  communes,
  organismeCertificateur,
  parcellaires,
  parcellairesMetadata,
  parcelleCultures,
  parcelles
} from '../../database/schema/index.js'
import type {
  AttestationsProductionsStatus,
  AttestationsProductionsType,
  CartoBioCulture
} from '@agencebio/cartobio-types'
import {
  createAttestationProductionSchema,
  productionAttestationStatusEnumSchema,
  updateAttestationProductionSchema
} from '../../database/validations/activites.js'
import { sansDateParDefaut, surfaceHa } from './exports.utils.js'
import { isoTimestamp } from '../../shared/parcellaires/parcellaires.utils.js'
import type { AttestationProduction, ExportRow, PdfParcelle, PdfRecord } from './exports.types.js'

export async function updateAttestationsProductions(
  recordId: string,
  status: AttestationsProductionsStatus,
  type: AttestationsProductionsType,
  path: string | null = null
): Promise<void> {
  await db
    .insert(attestationsProduction)
    .values(createAttestationProductionSchema.parse({ recordId, type, status, path }))
    .onConflictDoUpdate({
      target: [attestationsProduction.recordId, attestationsProduction.type],
      set: { status, path, updatedAt: new Date() }
    })
}

export async function findValidAttestationProduction(
  recordId: string,
  type: AttestationsProductionsType
): Promise<AttestationProduction | null> {
  const [production] = await db
    .select({ path: attestationsProduction.path })
    .from(attestationsProduction)
    .innerJoin(parcellaires, eq(parcellaires.recordId, attestationsProduction.recordId))
    .where(
      and(
        eq(attestationsProduction.recordId, recordId),
        gt(attestationsProduction.updatedAt, parcellaires.updatedAt),
        eq(attestationsProduction.status, productionAttestationStatusEnumSchema.enum.generated),
        eq(attestationsProduction.type, type),
        isNotNull(attestationsProduction.path)
      )
    )

  return production?.path ? { path: production.path } : null
}

export async function failInterruptedAttestationsProductions(): Promise<number> {
  const { rowCount } = await db
    .update(attestationsProduction)
    .set({
      ...updateAttestationProductionSchema.parse({
        status: productionAttestationStatusEnumSchema.enum.error
      }),
      updatedAt: new Date()
    })
    .where(
      and(
        eq(attestationsProduction.status, productionAttestationStatusEnumSchema.enum.started),
        lt(attestationsProduction.updatedAt, new Date(Date.now() - 60 * 60 * 1000))
      )
    )
  return rowCount ?? 0
}

export async function findKeptAttestationsPaths(): Promise<string[]> {
  const rows = await db
    .select({ path: attestationsProduction.path })
    .from(attestationsProduction)
    .where(
      and(
        isNotNull(attestationsProduction.path),
        eq(attestationsProduction.status, productionAttestationStatusEnumSchema.enum.generated)
      )
    )

  return rows.flatMap(({ path }) => (path ? [path] : []))
}

export async function deleteAttestationsProductions(recordId: string): Promise<void> {
  await db.delete(attestationsProduction).where(eq(attestationsProduction.recordId, recordId))
}

export async function findPdfRecord(recordId: string): Promise<PdfRecord | null> {
  const [record] = await db
    .select({
      version_name: parcellaires.versionNom,
      audit_date: parcellaires.auditDate,
      annee_reference_controle: parcellaires.anneeReferenceControle,
      mixite: parcellaires.mixite,
      oc_label: organismeCertificateur.label,
      certification_date_debut: parcellaires.certificationDateDebut,
      certification_date_fin: parcellaires.certificationDateFin
    })
    .from(parcellaires)
    .leftJoin(organismeCertificateur, eq(organismeCertificateur.id, parcellaires.ocId))
    .where(eq(parcellaires.recordId, recordId))

  return record ?? null
}

export async function findExportRows(ocId: number, numeroBios: number[]): Promise<ExportRow[]> {
  const rows = await db
    .select({
      record_id: parcellaires.recordId,
      numerobio: parcellaires.numeroBio,
      version_name: parcellaires.versionNom,
      source: parcellairesMetadata.source,
      provenance: parcellairesMetadata.provenance,
      campagne: parcellairesMetadata.campagne,
      created_at: isoTimestamp(parcellaires.createdAt),
      updated_at: isoTimestamp(parcellaires.updatedAt),
      mixite: parcellaires.mixite,
      anneereference: parcellaires.anneeReferenceControle,
      certification_state: parcellaires.certificationEtat,
      audit_date: parcellaires.auditDate,
      audit_notes: parcellaires.auditNotesCertif,
      certification_date_debut: parcellaires.certificationDateDebut,
      certification_date_fin: parcellaires.certificationDateFin,
      nombre_parcelles: count(parcelles.id),
      superficie_totale_ha: surfaceHa(),
      surface_conventionnel_ha: surfaceHa('CONV'),
      surface_c1_ha: surfaceHa('C1'),
      surface_c2_ha: surfaceHa('C2'),
      surface_c3_ha: surfaceHa('C3'),
      surface_ab_ha: surfaceHa('AB')
    })
    .from(parcellaires)
    .leftJoin(parcellairesMetadata, eq(parcellairesMetadata.recordId, parcellaires.recordId))
    .leftJoin(parcelles, and(eq(parcelles.recordId, parcellaires.recordId), isNull(parcelles.deletedAt)))
    .where(
      and(eq(parcellaires.ocId, ocId), inArray(parcellaires.numeroBio, numeroBios), isNull(parcellaires.deletedAt))
    )
    .groupBy(parcellaires.recordId, parcellairesMetadata.recordId)
    .orderBy(asc(parcellaires.numeroBio))

  return rows.map((row) => ({
    ...row,
    campagne: row.campagne === null ? null : String(row.campagne),
    audit_date: sansDateParDefaut(row.audit_date),
    certification_date_debut: sansDateParDefaut(row.certification_date_debut),
    certification_date_fin: sansDateParDefaut(row.certification_date_fin)
  }))
}

export async function findPdfParcelles(recordId: string, pac: boolean): Promise<PdfParcelle[]> {
  const cultures = db
    .select({
      cultures: sql<CartoBioCulture[]>`COALESCE(json_agg(json_build_object(
        'id', ${parcelleCultures.id},
        'CPF', ${parcelleCultures.cpf},
        'TYPE', ${parcelleCultures.codeCultureImport},
        'variete', ${parcelleCultures.variete},
        'surface', ${parcelleCultures.surface},
        'unit', ${parcelleCultures.unit},
        'date_semis', ${parcelleCultures.dateSemis}
      )), '[]'::json)`
    })
    .from(parcelleCultures)
    .where(and(eq(parcelleCultures.recordId, parcelles.recordId), eq(parcelleCultures.parcelleId, parcelles.id)))

  const rows = await db
    .select({
      id: parcelles.id,
      name: parcelles.name,
      cultures: sql<CartoBioCulture[]>`(${cultures})`,
      conversion_niveau: parcelles.conversionNiveau,
      commune: parcelles.commune,
      communename: communes.nom,
      created: parcelles.createdAt,
      engagement_date: parcelles.engagementDate,
      nbilot: parcelles.numeroIlotPac,
      nbp: parcelles.numeroParcellesPac,
      refcad: parcelles.referenceCadastre,
      geojson: sql<string>`ST_AsGeoJSON(${parcelles.geometry})`,
      minx: sql<number>`ST_XMin(${parcelles.geometry})`,
      miny: sql<number>`ST_YMin(${parcelles.geometry})`,
      maxx: sql<number>`ST_XMax(${parcelles.geometry})`,
      maxy: sql<number>`ST_YMax(${parcelles.geometry})`,
      centerx: sql<number>`ST_X(ST_Centroid(${parcelles.geometry}))`,
      centery: sql<number>`ST_Y(ST_Centroid(${parcelles.geometry}))`,
      superficie_totale_ha: parcelles.surfaceHa
    })
    .from(parcelles)
    .leftJoin(communes, eq(communes.fid, parcelles.commune))
    .where(
      and(
        eq(parcelles.recordId, recordId),
        isNull(parcelles.deletedAt),
        pac
          ? or(and(ne(parcelles.numeroIlotPac, 0), ne(parcelles.numeroParcellesPac, 0)), eq(parcelles.attentePac, true))
          : undefined
      )
    )

  return rows.map((row) => ({
    ...row,
    communename: row.communename ?? 'inconnu',
    nbilot: row.nbilot === null ? null : String(row.nbilot),
    nbp: row.nbp === null ? null : String(row.nbp)
  }))
}
