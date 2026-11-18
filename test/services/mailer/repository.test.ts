import { db } from '../../../src/database/database.js'
import { organismeCertificateur, parcellaireImport } from '../../../src/database/schema/index.js'
import { findDestinatairesRapport, findStatsByOrganisme } from '../../../src/services/mailer/mailer.repository.js'

const start = new Date('2026-10-26T00:00:00Z')
const end = new Date('2026-11-01T23:59:59Z')

async function insertJobs(jobs: Array<Partial<typeof parcellaireImport.$inferInsert>>): Promise<void> {
  await db.insert(parcellaireImport).values(jobs.map((job) => ({ organismeCertificateur: 9001, ...job })))
}

describe('findStatsByOrganisme', () => {
  test("compte les envois terminés dans la période par statut pour l'organisme demandé", async () => {
    const inRange = new Date('2026-10-28T10:00:00Z')
    await insertJobs([
      { endedAt: inRange, statutJob: 'VALID' },
      { endedAt: inRange, statutJob: 'VALID' },
      { endedAt: inRange, statutJob: 'REJECTED' },
      { endedAt: inRange, statutJob: 'ERROR' },
      { endedAt: inRange, statutJob: null },
      { endedAt: start, statutJob: 'VALID' },
      { endedAt: end, statutJob: 'REJECTED' },
      { endedAt: new Date('2026-10-25T23:59:59Z'), statutJob: 'VALID' },
      { endedAt: new Date('2026-11-02T00:00:00Z'), statutJob: 'VALID' },
      { endedAt: null, statutJob: 'VALID' },
      { organismeCertificateur: 9002, endedAt: inRange, statutJob: 'VALID' }
    ])

    expect(await findStatsByOrganisme(9001, start, end)).toEqual({
      organismeCertificateur: 9001,
      totalRecu: 7,
      totalAcceptes: 3,
      totalRefuses: 3
    })
  })

  test("retourne null quand l'organisme n'a aucun envoi dans la période", async () => {
    await insertJobs([{ endedAt: new Date('2026-09-01T00:00:00Z'), statutJob: 'VALID' }])

    expect(await findStatsByOrganisme(9001, start, end)).toBeNull()
  })
})

describe('findDestinatairesRapport', () => {
  test('retourne une ligne par email des organismes actifs uniquement', async () => {
    await db.insert(organismeCertificateur).values([
      { id: 9001, label: 'OC actif', email: ['a@oc.fr', 'b@oc.fr'], active: true },
      { id: 9002, label: 'OC inactif', email: ['c@oc.fr'], active: false },
      { id: 9003, label: 'OC sans email', email: null, active: true }
    ])

    const destinataires = (await findDestinatairesRapport()).filter(({ id }) => id >= 9001)

    expect(destinataires).toHaveLength(2)
    expect(destinataires).toEqual(
      expect.arrayContaining([
        { id: 9001, label: 'OC actif', email: 'a@oc.fr' },
        { id: 9001, label: 'OC actif', email: 'b@oc.fr' }
      ])
    )
  })
})
