/**
 * @typedef {'asc' | 'desc'} OrdreTri
 */

/**
 * @typedef {Object} DashboardQuery
 * @property {string} [from]
 * @property {string} [to]
 * @property {string} [page]
 * @property {string} [limit]
 * @property {string} [numeroBio]
 * @property {string} [numeroClient]
 * @property {string} [auditDate]
 * @property {string} [recherche]
 * @property {string} [statuts]
 * @property {string} [etats]
 * @property {string | OrdreTri} [ordreDate]
 */

/**
 * @typedef {Object} DashboardRoute
 * @property {DashboardQuery} Querystring
 */

/**
 * @typedef {Object} DateRange
 * @property {string} [from]
 * @property {string} [to]
 */

/**
 * @typedef {DateRange & {
 *   page: number,
 *   limit: number,
 *   recherche?: string,
 *   statuts?: string[],
 *   etats?: string[],
 *   ordreDate?: OrdreTri
 * }} PaginationParams
 */

/**
 * @typedef {Object} HistoriqueParcellaireParams
 * @property {string} [numeroBio]
 * @property {string} [numeroClient]
 * @property {string} [auditDate]
 */

/**
 * @typedef {'day' | 'week' | 'month'} Granularity
 */

/**
 * @typedef {Object} ErrorDetail
 * @property {string | null} numeroBio
 * @property {number | null} parcelleId
 * @property {string | null} parcelleName
 * @property {string | null} code
 * @property {string | null} message
 */

/**
 * @typedef {Object} ErrorByCode
 * @property {string | null} code
 * @property {number | null} count
 */

/**
 * @typedef {Object} KpiResponse
 * @property {number} totalEnvoyes
 * @property {number} totalValides
 * @property {number} totalRejetes
 * @property {{ code: string, count: number } | null} anomaliePlusFrequente
 */

/**
 * @typedef {Object} BilanResponse
 * @property {number} totalRecu
 * @property {number} totalAcceptes
 * @property {number} totalRefuses
 * @property {number} tauxRefus
 */

/**
 * @typedef {Object} HistoriqueParams
 * @property {string} [numeroBio]
 * @property {string} [numeroClient]
 * @property {string} [auditDate]
 */

/**
 * @param {string} statut
 * @returns {'success' | 'echec' | null}
 */
function getTypeEnvoi(statut) {
  if (statut === "VALID") {
    return "success";
  }

  if (statut === "REJECTED" || statut === "ERROR") {
    return "echec";
  }

  return null;
}

const NB_MINIMUM_STREAK = 3;

/**
 * @param {{ statut: string }[]} envois
 * @returns {Set<number>}
 */
function getIndexesStreaksSuspectes(envois) {
  const indexes = new Set();
  let streakStart = 0;

  for (let i = 1; i <= envois.length; i++) {
    const typeDebut = getTypeEnvoi(envois[streakStart].statut);

    const sameType =
      i < envois.length &&
      getTypeEnvoi(envois[i].statut) === typeDebut &&
      typeDebut !== null;

    if (!sameType) {
      const streakLength = i - streakStart;

      if (streakLength >= NB_MINIMUM_STREAK && typeDebut !== null) {
        for (let j = streakStart; j < i; j++) {
          indexes.add(j);
        }
      }

      streakStart = i;
    }
  }

  return indexes;
}

module.exports = { getIndexesStreaksSuspectes };
