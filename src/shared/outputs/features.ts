import { randomInt, randomUUID } from 'crypto'
import { fromCodePacStrict, fromCodeCpf } from '@agencebio/rosetta-cultures'
import type { CartoBioFeature, CartoBioFeatureInput } from '@agencebio/cartobio-types'
import type { DBParcelle } from '../parcellaires/parcellaires.types.js'

const MAX_RANDOM_INT = Math.pow(2, 48)


/**
 * Returns a numeric value which serves as a GeoJSON Feature id
 * Up to maplibre-gl@3.3.1, only integer id works.
 *
 * @see https://github.com/maplibre/maplibre-gl-js/issues/1043
 */
function getRandomFeatureId (): number {
  return randomInt(1, MAX_RANDOM_INT)
}

/**
 * Soft migration from single culture to multi-cultures
 *
 * 1. If we have an array of cultures, it means the job is done.
 * 2. If we have TYPE or CPF, we merge them with a first cultures item
 *
 * Also, about CPF and TYPE
 * 1. Because they are explitly set from a controlled-list via the UI (the `is_selectable` crop attribute)
 * 2. Because they are translated from a PAC code (the `TYPE` feature property)
 * 3. Or because they are set from an external system (the crop may or may not be selectable via the UI)
 */
function populateWithMultipleCultures<F extends CartoBioFeatureInput> (feature: F): F {
  // convert from single to multi
  if (!Array.isArray(feature.properties.cultures)) {
    const { CPF, TYPE = null, variete = null, SURF: surface = null } = feature.properties

    feature.properties.cultures = [
      {
        id: randomUUID(),
        CPF,
        TYPE,
        surface,
        variete
      }
    ]

    delete feature.properties.CPF
    delete feature.properties.variete
  }

  // populate with CPF until we do a database migration to align these data
  feature.properties.cultures = feature.properties.cultures.map(culture => {
    if (fromCodeCpf(culture.CPF || '')?.is_selectable) {
      return culture
    }

    if (culture.TYPE) {
      return {
        ...culture,
        CPF: fromCodePacStrict(culture.TYPE)?.code_cpf
      }
    }

    return culture
  })

  return feature
}

function normalizeParcelle (parcelle: DBParcelle): CartoBioFeature {
  return {
    type: 'Feature',
    id: parcelle.id,
    properties: {
      id: parcelle.id,
      COMMUNE: parcelle.commune ?? null,
      COMMUNE_LABEL: parcelle.commune_label ?? undefined,
      cultures: parcelle.cultures ?? null,
      conversion_niveau: parcelle.conversion_niveau ?? null,
      engagement_date: parcelle.engagement_date ?? null,
      commentaires: parcelle.commentaire ?? null,
      auditeur_notes: parcelle.auditeur_notes ?? null,
      annotations: parcelle.annotations ?? null,
      NOM: parcelle.name ?? null,
      PACAGE: parcelle.numero_pacage ?? null,
      NUMERO_I: parcelle.numero_ilot_pac ?? null,
      NUMERO_P: parcelle.numero_parcelle_pac ?? null,
      cadastre: parcelle.reference_cadastre?.length && parcelle.reference_cadastre[0] ? parcelle.reference_cadastre : null,
      CODE_CULTURE: parcelle.code_culture_pac ?? null,
      CODE_PRECISION: parcelle.code_precision_pac ?? null,
      createdAt: parcelle.created ?? null,
      updatedAt: parcelle.updated ?? null,
      etranger: parcelle.etranger === true,
      controlee: parcelle.controlee === true,
      historique: parcelle.historique_cultures?.filter((current, i, a) => {
        const previous = a[i - 1]
        if (!previous) {
          return true
        }
        if (current.annee_controle !== previous.annee_controle) {
          return true
        }

        if (
          (previous.cultures === null && current.cultures != null) ||
          (previous.cultures != null && current.cultures === null) ||
          previous.cultures.length !== current.cultures.length) {
          return true
        }

        if (!current.cultures.every((c) => previous.cultures.some((pc) => pc.CPF === c.CPF))) {
          return true
        }

        return false
      }) ?? null,
      attente_pac: parcelle.attente_pac ?? false
    },
    geometry: parcelle.geometry ?? null
  }
}

export { getRandomFeatureId, populateWithMultipleCultures, normalizeParcelle }
