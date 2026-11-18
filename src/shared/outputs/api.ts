import { sql } from 'drizzle-orm'
import { db, firstRow } from '../../database/database.js'
import type {
  EtatProduction,
  NormalizedRecord,
  CartoBioFeature,
  CartoBioCulture,
  OutputApiRecord,
  OutputApiCulture,
  OutputApiParcelle
} from '@agencebio/cartobio-types'

function cultureToApi(culture: CartoBioCulture): OutputApiCulture {
  return {
    cpf: culture.CPF,
    surface: culture.surface && !Number.isNaN(culture.surface) ? Number(culture.surface) : null,
    unite: culture.unit === '%' ? '%' : 'ha',
    variete: culture.variete,
    dateSemis: culture.date_semis
  }
}

function parcelleToApi(parcelle: CartoBioFeature, surface: number): OutputApiParcelle {
  return {
    ...parcelle,
    properties: {
      id: String(parcelle.id),
      surface: surface / 10000,
      commune: parcelle.properties.COMMUNE,
      cultures: parcelle.properties.cultures.map(cultureToApi),
      niveauConversion: parcelle.properties.conversion_niveau as EtatProduction,
      dateEngagement: parcelle.properties.engagement_date,
      commentaire: parcelle.properties.auditeur_notes,
      annotations: parcelle.properties.annotations,
      dateAjout: parcelle.properties.createdAt,
      dateMiseAJour: parcelle.properties.updatedAt,
      nom: parcelle.properties.NOM,
      numeroPacage: parcelle.properties.PACAGE,
      numeroIlotPAC: parcelle.properties.NUMERO_I,
      numeroParcellePAC: parcelle.properties.NUMERO_P,
      referenceCadastrale: parcelle.properties.cadastre?.join(' ') ?? null
    }
  }
}

async function recordsToApi(records: NormalizedRecord[]): Promise<OutputApiRecord[]> {
  const surfaces = await legalProjectionSurfaces(
    records.flatMap((record) => record.parcelles.features.map((feature) => feature.geometry))
  )
  let index = 0

  return records.map((record) => ({
    numeroBio: record.numerobio,
    version_name: record.version_name,
    certification: {
      statut: record.certification_state,
      dateAudit: record.audit_date,
      dateDebut: record.certification_date_debut,
      dateFin: record.certification_date_fin,
      demandesAudit: record.audit_demandes,
      notesAudit: record.audit_notes,
      anneeReferenceControle: record.annee_reference_controle
    },
    parcellaire: {
      type: 'FeatureCollection',
      features: record.parcelles.features.map((feature) => parcelleToApi(feature, surfaces[index++] ?? 0))
    }
  }))
}

async function recordToApi(record: NormalizedRecord): Promise<OutputApiRecord> {
  return firstRow(await recordsToApi([record]))
}

async function legalProjectionSurfaces(geometries: unknown[]): Promise<Array<number | null>> {
  if (!geometries.length) return []

  const { rows } = await db.execute<{ surface: number | null }>(sql`
    SELECT CASE WHEN jsonb_typeof(g.value) = 'object'
      THEN ST_Area(cartobio.to_legal_projection(ST_GeomFromGeoJSON(g.value)))
    END AS surface
    FROM jsonb_array_elements(${JSON.stringify(geometries)}::jsonb) WITH ORDINALITY AS g(value, ord)
    ORDER BY g.ord
  `)
  return rows.map(({ surface }) => surface)
}

async function surfaceForFeatureCollection(featureCollection: {
  features: Array<{ geometry?: unknown }>
}): Promise<number> {
  const surfaces = await legalProjectionSurfaces(featureCollection.features.map((feature) => feature.geometry ?? null))
  return surfaces.reduce<number>((total, surface) => total + (surface || 0), 0)
}

export { recordToApi, recordsToApi, surfaceForFeatureCollection }
