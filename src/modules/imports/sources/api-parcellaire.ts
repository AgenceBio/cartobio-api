import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { polygon } from '@turf/helpers'
import bboxPolygon from '@turf/bbox-polygon'
import polygonInPolygon from '@turf/boolean-intersects'
import { fromCodeCpf } from '@agencebio/rosetta-cultures'
import {
  CertificationState,
  EtatProduction,
  ImportLogCode,
  MetadataSource,
  RegionBounds
} from '@agencebio/cartobio-types'
import type {
  AgenceBioNormalizedOperator,
  CartoBioFeatureInput,
  FeaturePropertiesInput,
  InputApiParcelleBody,
  InputApiRecordBody,
  OrganismeCertificateur
} from '@agencebio/cartobio-types'
import type { Position } from 'geojson'
import { getRandomFeatureId } from '../../../shared/outputs/features.js'
import { normalizeEtatProduction } from '../../../shared/outputs/record.js'
import { parsePacDetailsFromComment, fetchOperatorByNumeroBio } from '../../../clients/agence-bio.client.js'
import type { FeatureError, ImportWarning, ParsedRecord, RecordError } from '../imports.types.js'
import { logger } from '../../../config/logger.js'
import { BadGatewayApiError, getResponseStatusCode } from '../../../shared/errors.js'

function formatParcelleName(parcelle: InputApiParcelleBody): string {
  const ilot = parcelle.numeroIlot != null ? String(parcelle.numeroIlot) : null
  const num = parcelle.numeroParcelle != null ? String(parcelle.numeroParcelle) : null
  if (parcelle.nom) return `${parcelle.nom}`
  if (ilot && num) return `Îlot ${ilot} parcelle ${num}`
  if (ilot) return `Îlot ${ilot}`
  if (num) return `Parcelle ${num}`
  return '-'
}

function buildFeatureError(parcelle: InputApiParcelleBody, message: string, code: ImportLogCode): FeatureError {
  return {
    code,
    message,
    idParcelle: parcelle.id,
    nomParcelle: formatParcelleName(parcelle)
  }
}

const coordinatesSchema = z.array(
  z.array(
    z
      .tuple(
        [
          z.number('les coordonnées doivent être des nombres finis'),
          z.number('les coordonnées doivent être des nombres finis')
        ],
        z.number()
      )
      .refine(([, y]) => y >= -90 && y <= 90, 'la latitude doit être comprise entre 90 et -90')
      .refine(([x]) => x >= -180 && x <= 180, 'la longitude doit être comprise entre 180 et -180')
  )
)

export async function parseAPIParcellaire(
  payload: InputApiRecordBody,
  { organismeCertificateur }: { organismeCertificateur: OrganismeCertificateur }
): Promise<ParsedRecord> {
  const record = payload
  const parcelleWarnings: ImportWarning[] = []
  const recordErrors: RecordError[] = []

  const operator = await fetchOperator(String(record.numeroBio))

  if (operator == null) {
    recordErrors.push({
      message: 'Numéro bio inconnu du portail de notification',
      code: ImportLogCode.UNKNOWN_NUMERO_BIO
    })
  } else {
    if (!operator.isProduction) {
      recordErrors.push({
        message: 'Numéro bio sans notification liée à une activité de production',
        code: ImportLogCode.NOT_PRODUCTION
      })
    }
    if (!Object.hasOwn(operator.organismeCertificateur, 'id')) {
      recordErrors.push({
        message: 'Aucun organisme certificateur pour ce numéro bio.',
        code: ImportLogCode.NO_OC
      })
    } else if (
      operator.organismeCertificateur.id !== organismeCertificateur.id ||
      !('numeroClient' in operator.organismeCertificateur) ||
      operator.organismeCertificateur.numeroClient !== String(record.numeroClient)
    ) {
      recordErrors.push({
        message: 'Numéro client différent',
        code: ImportLogCode.OC_MISMATCH
      })
    }
  }

  if (record.dateCertificationDebut && isNaN(Date.parse(record.dateCertificationDebut))) {
    recordErrors.push({
      message: 'champ dateCertificationDebut incorrect',
      code: ImportLogCode.INVALID_DATE_CERTIFICATION_DEBUT
    })
  }

  if (record.dateCertificationFin && isNaN(Date.parse(record.dateCertificationFin))) {
    recordErrors.push({
      message: 'champ dateCertificationFin incorrect',
      code: ImportLogCode.INVALID_DATE_CERTIFICATION_FIN
    })
  }

  if (!record.dateCertificationDebut || !record.dateCertificationFin) {
    recordErrors.push({
      message: 'Opérateur certifié sans dates de certification renseignées',
      code: ImportLogCode.MISSING_CERTIFICATION_DATES
    })
  }

  if (isNaN(Date.parse(record.dateAudit ?? ''))) {
    recordErrors.push({
      message: 'champ dateAudit incorrect',
      code: ImportLogCode.INVALID_DATE_AUDIT
    })
  }

  const featureErrors: FeatureError[] = []

  const features = await Promise.all(
    record.parcelles.map(async (parcelle) => {
      const id = String(parcelle.id ?? getRandomFeatureId())
      const cultures = parcelle.culture ?? parcelle.cultures
      const pac = parsePacDetailsFromComment(parcelle.commentaire)
      const numeroIlot = parseInt(String(parcelle.numeroIlot), 10)
      const numeroParcelle = parseInt(String(parcelle.numeroParcelle), 10)

      if (
        !Number.isNaN(numeroIlot) &&
        numeroIlot !== 0 &&
        (parcelle.enAttentePac === true || parcelle.enAttentePac === 1)
      ) {
        parcelle.enAttentePac = false
        parcelleWarnings.push({
          numeroBio: String(record.numeroBio),
          message: `Parcelle ${id ?? ''} acceptée mais ne peut être en attente PAC car un ilôt PAC est renseigné`,
          code: ImportLogCode.PAC_PENDING_WITH_ILOT
        })
      }

      let conversionNiveau: EtatProduction | undefined
      try {
        conversionNiveau = parcelle.etatProduction
          ? (normalizeEtatProduction(parcelle.etatProduction, { strict: true }) as EtatProduction)
          : undefined
        if (
          conversionNiveau !== null &&
          [EtatProduction.C1, EtatProduction.C2, EtatProduction.C3].some((etat) => etat === conversionNiveau) &&
          !Date.parse(parcelle.dateEngagement ?? '')
        ) {
          featureErrors.push(
            buildFeatureError(
              parcelle,
              "Champ date d'engagement obligatoire lorsque que la parcelle est en conversion",
              ImportLogCode.MISSING_DATE_ENGAGEMENT
            )
          )
        }
      } catch (error) {
        logger.warn({ err: error }, 'champ etatProduction incorrect')
        featureErrors.push(
          buildFeatureError(parcelle, 'champ etatProduction incorrect', ImportLogCode.INVALID_ETAT_PRODUCTION)
        )
      }
      const properties: FeaturePropertiesInput = {
        id,
        cultures: cultures?.map(({ codeCPF, quantite, variete = '', dateSemis = '', unite }) => ({
          id: randomUUID(),
          CPF: codeCPF,
          date_semis: dateSemis,
          surface: parseFloat(String(quantite)),
          unit: unite,
          variete
        })),
        NUMERO_I: Number.isNaN(numeroIlot) ? (pac ? (pac.numeroIlot ?? null) : null) : String(numeroIlot),
        NUMERO_P: Number.isNaN(numeroParcelle) ? (pac ? (pac.numeroParcelle ?? null) : null) : String(numeroParcelle),
        PACAGE: record.numeroPacage ? String(record.numeroPacage) : null,
        conversion_niveau: conversionNiveau ?? '',
        engagement_date: parcelle.dateEngagement ?? null,
        auditeur_notes: parcelle.commentaire ?? null,
        TYPE: parcelle.codeCulture ?? null,
        CODE_VAR: parcelle.codePrecision ?? null,
        COMMUNE: parcelle.commune ?? null,
        NOM: parcelle.nom ?? null,
        attente_pac: parcelle.enAttentePac === true || parcelle.enAttentePac === 1
      }

      if (parcelle.dateEngagement && !Date.parse(parcelle.dateEngagement)) {
        featureErrors.push(
          buildFeatureError(parcelle, 'champ dateEngagement incorrect', ImportLogCode.INVALID_DATE_ENGAGEMENT)
        )
      }
      if (!cultures?.length) {
        featureErrors.push(buildFeatureError(parcelle, 'cultures absentes', ImportLogCode.MISSING_CULTURES))
      }

      const invalidCodes = (cultures ?? []).filter((c) => !fromCodeCpf(c.codeCPF ?? '')).map((c) => c.codeCPF)

      if (invalidCodes.length > 0) {
        featureErrors.push(
          buildFeatureError(parcelle, `cultures inconnues: ${invalidCodes.join(', ')}`, ImportLogCode.INVALID_CPF)
        )
      }

      let coordinates: Position[][] = []

      if (parcelle.geom === null || parcelle.geom === undefined || parcelle.geom === '' || parcelle.geom === 'null') {
        parcelleWarnings.push({
          numeroBio: String(record.numeroBio),
          message: `Parcelle ${id ?? ''} n'a pas de géométrie`,
          code: ImportLogCode.MISSING_GEOM
        })
        const featureSansGeometrie: CartoBioFeatureInput = {
          type: 'Feature',
          id,
          geometry: null,
          properties
        }
        return featureSansGeometrie
      }

      try {
        const parsed = coordinatesSchema.safeParse(JSON.parse(parcelle.geom.replace(/}$/, '')))
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message)
        coordinates = parsed.data
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        featureErrors.push(buildFeatureError(parcelle, 'champ geom incorrect : ' + message, ImportLogCode.INVALID_GEOM))
        return null
      }

      let resPolygon

      try {
        resPolygon = polygon(coordinates, properties, { id })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        featureErrors.push(buildFeatureError(parcelle, 'champ geom incorrect : ' + message, ImportLogCode.INVALID_GEOM))
      }

      if (!resPolygon) {
        return null
      }

      for (const [, bbox] of Object.entries(RegionBounds)) {
        const regionGeometry = bboxPolygon([bbox[0], bbox[1], bbox[2], bbox[3]])

        if (polygonInPolygon(resPolygon, regionGeometry)) {
          return resPolygon
        }
      }

      parcelleWarnings.push({
        numeroBio: String(record.numeroBio),
        message: `Parcelle ${id ?? ''} en dehors des régions autorisées`,
        code: ImportLogCode.GEOM_OUT_OF_BOUNDS
      })
      return resPolygon
    })
  )

  const allErrors = [...recordErrors, ...featureErrors]

  if (allErrors.length > 0) {
    return {
      numeroBio: String(record.numeroBio),
      errors: allErrors,
      json: record
    }
  }

  return {
    record: {
      numerobio: String(record.numeroBio),
      certification_state: CertificationState.CERTIFIED,
      oc_id: organismeCertificateur.id,
      oc_label: organismeCertificateur.nom,
      numero_client: String(record.numeroClient),
      parcelles: {
        type: 'FeatureCollection' as const,
        features: features.filter((f) => f !== null)
      },
      audit_notes: record.commentaire,
      certification_date_debut: record.dateCertificationDebut,
      certification_date_fin: record.dateCertificationFin,
      audit_date: new Date(record.dateAudit ?? '').toISOString(),
      annee_reference_controle: record.anneeReferenceControle ?? undefined,
      metadata: {
        source: MetadataSource.API_PARCELLAIRE,
        sourceLastUpdate: new Date().toISOString(),
        anneeAssolement: record.anneeAssolement
      }
    },
    numeroBio: String(record.numeroBio),
    warnings: parcelleWarnings,
    json: record
  }
}

async function fetchOperator(numeroBio: string): Promise<AgenceBioNormalizedOperator | null> {
  try {
    return await fetchOperatorByNumeroBio(numeroBio)
  } catch (error) {
    if (getResponseStatusCode(error) !== 404) {
      throw new BadGatewayApiError("Le portail de l'Agence Bio n'a pas pu être contacté.", {
        cause: error
      })
    }
    logger.error({ err: error }, `Opérateur ${numeroBio} introuvable`)
    return null
  }
}
