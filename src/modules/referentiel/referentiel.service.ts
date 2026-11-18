import * as repository from './referentiel.repository.js'
import type { DepartementRow } from './referentiel.types.js'
import type { DepartementsResponse } from '@agencebio/cartobio-types'

async function getDepartement (): Promise<DepartementsResponse> {
  const rows = await repository.findDepartements()
  const grouped = rows.reduce<Record<string, DepartementRow[]>>((regions, row) => {
    (regions[row.nomRegion] ??= []).push(row)
    return regions
  }, {})
  return Object.fromEntries(Object.keys(grouped).sort().map(region => [region, (grouped[region] ?? []).map(({ code, nom }) => ({ code, nom })).sort((a, b) => a.nom.localeCompare(b.nom))]))
}

export { getDepartement }
