import type { AgenceBioNormalizedOperator } from '@agencebio/cartobio-types'
import type { AgenceBioOperator, AgenceBioNotification } from '../../clients/agence-bio.types.js'
import { agenceBioNotificationSchema } from '../../clients/agence-bio.types.js'
import type { AgenceBioNormalizedOperatorWithFilterData } from '../../modules/operators/operators.types.js'

function sortRecord(
  a: AgenceBioNormalizedOperatorWithFilterData,
  b: AgenceBioNormalizedOperatorWithFilterData,
  sortKey?: string | null
): number {
  switch (sortKey) {
    case 'date-audit-ASC':
      if (a.max_audit_date == b.max_audit_date) {
        break
      }
      if (a.max_audit_date == null) {
        return -1
      }
      if (b.max_audit_date == null) {
        return 1
      }

      return new Date(a.max_audit_date).getTime() - new Date(b.max_audit_date).getTime()

    case 'date-audit-DESC':
      if (a.max_audit_date == b.max_audit_date) {
        break
      }
      if (a.max_audit_date == null) {
        return 1
      }
      if (b.max_audit_date == null) {
        return -1
      }

      return new Date(b.max_audit_date).getTime() - new Date(a.max_audit_date).getTime()
  }

  if (a.nom === b.nom) {
    return 0
  }

  let res = 0

  if (a.nom == null && b.nom != null) {
    res = 1
  } else if (a.nom != null && b.nom == null) {
    res = -1
  } else {
    const aNom = a.nom ?? ''
    const bNom = b.nom ?? ''
    const aIsAlphabetical = aNom.localeCompare('a') >= 0
    const bIsAlphabetical = bNom.localeCompare('a') >= 0

    if (!aIsAlphabetical && bIsAlphabetical) {
      res = 1
    } else if (aIsAlphabetical && !bIsAlphabetical) {
      res = -1
    } else {
      res = aNom.localeCompare(bNom)
    }
  }
  if (sortKey === 'nom-DESC') {
    return -res
  }

  return res
}

/**
 * Always returns 9 digits PACAGE identifier
 */
function formatPacage(numeroPacage: null | string | number): string | null {
  return numeroPacage ? String(numeroPacage).padStart(9, '0') : null
}

/**
 * Normalize an operator to be used in Cartobio
 */
function normalizeOperator(operator: AgenceBioOperator): AgenceBioNormalizedOperator {
  const {
    id,
    nom,
    denominationCourante,
    siret,
    numeroBio,
    numeroPacage,
    notifications,
    dateEngagement,
    datePremierEngagement,
    adressesOperateurs = []
  } = operator
  const notification = notifications ? getNotification(notifications) : null
  const currentNotifications = notification
    ? agenceBioNotificationSchema
        .strip()
        .pick({
          etatCertification: true,
          status: true,
          organismeCertificateurId: true,
          numeroClient: true,
          dateDemarrage: true,
          dateArret: true,
          certification_state: true
        })
        .parse(notification)
    : null
  const adresses = adressesOperateurs ?? []
  let organismeCertificateur = {}
  if (notification && notification.organismeCertificateurId) {
    organismeCertificateur = {
      id: notification.organismeCertificateurId,
      nom: notification.organisme,
      numeroClient: notification.numeroClient
    }
  }

  return {
    id,
    nom,
    denominationCourante,
    siret,
    numeroBio,
    numeroPacage: formatPacage(numeroPacage ?? null),
    dateEngagement,
    datePremierEngagement,
    organismeCertificateur,
    adressesOperateurs: adresses
      .filter(({ active }) => active)
      .map(({ codeCommune, lieu, codePostal, ville }) => ({
        codeCommune,
        lieu,
        codePostal,
        ville
      })),
    codeCommune: adresses[0]?.codeCommune ?? null,
    departement: adresses[0]?.codeCommune?.slice(0, -3) ?? null,
    commune: adresses[0]?.ville ?? null,
    codePostal: adresses[0]?.codePostal ?? null,
    notifications: currentNotifications,
    isProduction: !notifications || notifications.some((n) => !n.activites || n.activites.some(({ id }) => id === 1))
  }
}

/**
 * Get the best notifications
 */
function getNotification(notifications: AgenceBioNotification[]): AgenceBioNotification | null {
  const priorityOrder = ['RETIREE', 'ENGAGEE', 'SUSPENDUE', 'ENGAGEE FUTUR', 'NON ENGAGEE', 'ARRETEE', 'BROUILLON']

  const withOldOC = notifications.filter((obj) => obj._oldOC)
  const withoutOldOC = notifications.filter((obj) => !obj._oldOC)

  if (withoutOldOC.length > 0) {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    notifications = notifications.filter((n) => {
      const certificationDate = new Date(n.updatedAt ?? '')
      return n.etatCertification !== 'NON ENGAGEE' || certificationDate > sixMonthsAgo
    })

    notifications = notifications.sort((a, b) => {
      const priorityA = priorityOrder.indexOf(a.etatCertification || 'BROUILLON')
      const priorityB = priorityOrder.indexOf(b.etatCertification || 'BROUILLON')

      return priorityA - priorityB
    })

    const groupedNotifications: Record<string, AgenceBioNotification[]> = {}

    notifications.forEach((n): void => {
      const key = `${n.numeroBio}-${n.organismeCertificateurId}`
      if (!groupedNotifications[key]) {
        groupedNotifications[key] = []
      }
      groupedNotifications[key].push(n)
    })

    Object.values(groupedNotifications).forEach((group): void => {
      group.sort((a, b) => {
        if (a.etatCertification === b.etatCertification) {
          if (a.etatCertification === 'ENGAGEE' || a.etatCertification === 'NON ENGAGEE') {
            return (
              new Date(b.dateDemarrage || b.dateArret || '').getTime() -
              new Date(a.dateDemarrage || a.dateArret || '').getTime()
            )
          }
          if (a.etatCertification === 'ARRETEE') {
            return (
              new Date(b.dateArret || b.dateDemarrage || '').getTime() -
              new Date(a.dateArret || a.dateDemarrage || '').getTime()
            )
          }
          return new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime()
        }
        return 0
      })
    })
    return Object.values(groupedNotifications).flat()[0] ?? null
  } else if (withOldOC.length > 0) {
    const [lastNotification] = withOldOC.sort(
      (a, b) => new Date(b.changementDate ?? '').getTime() - new Date(a.changementDate ?? '').getTime()
    )
    if (!lastNotification) return null
    lastNotification.certification_state = 'ARRETEE'
    return lastNotification
  } else return null
}
function applyOperatorTextSearch(record: AgenceBioNormalizedOperator, input?: string): boolean {
  const recordNom = record.nom
    ? record.nom
        .toLocaleLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    : ''
  const numClient =
    record.notifications && record.notifications.numeroClient
      ? record.notifications.numeroClient
          .toLocaleLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
      : ''
  const recordDenominationCourante = record.denominationCourante
    ? record.denominationCourante
        .toLocaleLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    : ''
  const recordSiret = record.siret ? record.siret.replace(' ', '') : ''
  input = input
    ? input
        .toLocaleLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    : ''

  if (!input) {
    return true
  }

  if (
    input &&
    (recordNom.includes(input) ||
      recordDenominationCourante.includes(input) ||
      numClient.includes(input) ||
      record.numeroBio.toString().includes(input) ||
      recordSiret.includes(input))
  ) {
    return true
  }

  return false
}

function filterOperatorForAutocomplete(record: AgenceBioNormalizedOperator, ocId: number): boolean {
  if (!record.notifications) return false

  if (record.notifications.status === 'BROUILLON') {
    return false
  }

  if (
    record.notifications.etatCertification === 'NON ENGAGEE' ||
    record.notifications.etatCertification === 'ARRETEE' ||
    record.notifications.organismeCertificateurId !== ocId ||
    record.notifications.etatCertification === 'RETIREE'
  ) {
    return false
  }
  return true
}

export { sortRecord, normalizeOperator, applyOperatorTextSearch, filterOperatorForAutocomplete }
