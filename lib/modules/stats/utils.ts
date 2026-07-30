export type OrdreTri = 'asc' | 'desc';

export type DashboardQuery = {
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
  numeroBio?: string;
  numeroClient?: string;
  auditDate?: string;
  recherche?: string;
  statuts?: string;
  etats?: string;
  ordreDate?: string;
};

export type DashboardRoute = {
  Querystring: DashboardQuery;
};

export type DateRange = {
  from?: string;
  to?: string;
};

export type PaginationParams = DateRange & {
  page: number;
  limit: number;
  recherche?: string;
  statuts?: string[];
  etats?: string[];
  ordreDate?: OrdreTri;
};

export type HistoriqueParcellaireParams = {
  numeroBio?: string;
  numeroClient?: string;
  auditDate?: string;
};

export type Granularity = 'day' | 'week' | 'month';

export type ErrorDetail = {
  numeroBio: string | null;
  parcelleId: number | null;
  parcelleName: string | null;
  code: string | null;
  message: string | null;
};

export type ErrorByCode = {
  code: string | null;
  count: number | null;
};

export type KpiResponse = {
  totalEnvoyes: number;
  totalValides: number;
  totalRejetes: number;
  anomaliePlusFrequente: {
    code: string;
    count: number;
  } | null;
};

export type BilanResponse = {
  totalRecu: number;
  totalAcceptes: number;
  totalRefuses: number;
  tauxRefus: number;
};

export type HistoriqueParams = {
  numeroBio?: string;
  numeroClient?: string;
  auditDate?: string;
};

function getTypeEnvoi (statut: string): 'success' | 'echec' | null {
  if (statut === 'VALID') {
    return 'success'
  }

  if (statut === 'REJECTED' || statut === 'ERROR') {
    return 'echec'
  }

  return null
}

const NB_MINIMUM_STREAK = 3

export function getIndexesStreaksSuspectes (
  envois: { statut: string }[]
): Set<number> {
  const indexes = new Set<number>()
  let streakStart = 0

  for (let i = 1; i <= envois.length; i++) {
    const typeDebut = getTypeEnvoi(envois[streakStart].statut)

    const sameType =
      i < envois.length &&
      getTypeEnvoi(envois[i].statut) === typeDebut &&
      typeDebut !== null

    if (!sameType) {
      const streakLength = i - streakStart

      if (streakLength >= NB_MINIMUM_STREAK && typeDebut !== null) {
        for (let j = streakStart; j < i; j++) {
          indexes.add(j)
        }
      }

      streakStart = i
    }
  }

  return indexes
}
