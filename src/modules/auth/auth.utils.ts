import { randomUUID } from 'node:crypto'
import { authStateSchema } from './auth.tokens.js'
import type { AuthState } from './auth.types.js'
import type { CartoBioUser, UserRole } from '@agencebio/cartobio-types'
import { UnauthorizedApiError } from '../../shared/errors.js'

export function encodeAuthState(state: AuthState): string {
  return `${randomUUID()}.${Buffer.from(JSON.stringify(state)).toString('base64url')}`
}

export function decodeAuthState(state: string): AuthState {
  const parsed = authStateSchema.safeParse(
    (() => {
      try {
        return JSON.parse(Buffer.from(state.split('.')[1] ?? '', 'base64url').toString())
      } catch {
        return null
      }
    })()
  )
  if (!parsed.success) throw new UnauthorizedApiError('état de connexion invalide, veuillez vous reconnecter.')
  return parsed.data
}

const GROUPE = {
  ADMIN: '1',
  CHARGE_CERTIFICATION: '2',
  SUPER_OC: '3',
  OPERATEUR: '4',
  AUDITEUR: '8'
} as const

type Groupe = (typeof GROUPE)[keyof typeof GROUPE]

function hasGroup(user: CartoBioUser | null | undefined, ...groupes: Groupe[]): boolean {
  if (!user) return false
  const userGroupes = [...(user.groups ?? []), user.mainGroup].map((group) => String(group?.id))
  return groupes.some((groupe) => userGroupes.includes(groupe))
}

export function isAdmin(user: CartoBioUser | null | undefined): boolean {
  return hasGroup(user, GROUPE.ADMIN)
}

export function isOperatorUser(user: CartoBioUser | null | undefined): boolean {
  return hasGroup(user, GROUPE.OPERATEUR)
}

export function isOc(user: CartoBioUser | null | undefined): boolean {
  return hasGroup(user, GROUPE.ADMIN, GROUPE.CHARGE_CERTIFICATION, GROUPE.SUPER_OC, GROUPE.AUDITEUR)
}

export function requiresOrganismeCertificateur(user: CartoBioUser | null | undefined): boolean {
  return hasGroup(user, GROUPE.CHARGE_CERTIFICATION, GROUPE.SUPER_OC, GROUPE.AUDITEUR)
}

export function isOcCertif(user: CartoBioUser | null | undefined): boolean {
  return hasGroup(user, GROUPE.ADMIN, GROUPE.CHARGE_CERTIFICATION, GROUPE.SUPER_OC)
}

export function isOcAudit(user: CartoBioUser | null | undefined): boolean {
  return hasGroup(user, GROUPE.ADMIN, GROUPE.SUPER_OC, GROUPE.AUDITEUR)
}

export function userRoles(user: CartoBioUser): UserRole[] {
  if (isOperatorUser(user)) return ['agri']
  return [
    ...(isAdmin(user) ? (['admin'] as const) : []),
    ...(isOcCertif(user) ? (['certif'] as const) : []),
    ...(isOcAudit(user) ? (['audit'] as const) : [])
  ]
}
