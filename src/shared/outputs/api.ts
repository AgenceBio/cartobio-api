
import { featureCollection } from '@turf/helpers'
import pool from '../../database/database.js'
import type { Geometry } from 'geojson'
import type { EtatProduction, NormalizedRecord, CartoBioFeature, CartoBioCulture, OutputApiRecord, OutputApiCulture, OutputApiParcelle } from '@agencebio/cartobio-types'

function cultureToApi (culture: CartoBioCulture): OutputApiCulture {
  return {
    cpf: culture.CPF,
    surface: (culture.surface && !Number.isNaN(culture.surface)) ? Number(culture.surface) : null,
    unite: culture.unit === '%' ? '%' : 'ha',
    variete: culture.variete,
    dateSemis: culture.date_semis
  }
}

async function parcelleToApi (parcelle: CartoBioFeature): Promise<OutputApiParcelle> {
  return {
    ...parcelle,
    properties: {
      id: String(parcelle.id),
      surface: await legalProjectionSurface(parcelle.geometry) / 10000,
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
async function recordToApi (record: NormalizedRecord): Promise<OutputApiRecord> {
  const featuresPromises = record.parcelles.features.map(parcelleToApi)
  const features = await Promise.all(featuresPromises)
  return {
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
    parcellaire: featureCollection(features)
  }
}

async function legalProjectionSurface (geometry: Geometry): Promise<number> {
  const { rows } = await pool.query<{ surface: number }>(
    /* sql */ `
      SELECT ST_Area(to_legal_projection(ST_GeomFromGeoJSON($1))) AS surface;
    `,
    [JSON.stringify(geometry)]
  )
  return rows[0].surface
}

async function surfaceForFeatureCollection (featureCollection: { features: Array<{ geometry?: Geometry | null }> }) {
  let totalSurface = 0

  for (const feature of featureCollection.features) {
    const geometry = feature.geometry

    if (!geometry) continue

    const { rows } = await pool.query(
      /* sql */ `
        SELECT ST_Area(to_legal_projection(ST_GeomFromGeoJSON($1))) AS surface;
      `,
      [JSON.stringify(geometry)]
    )

    const surface = rows[0]?.surface
    if (surface) {
      totalSurface += surface
    }
  }

  return totalSurface
}

export { recordToApi, parcelleToApi, legalProjectionSurface, surfaceForFeatureCollection }
