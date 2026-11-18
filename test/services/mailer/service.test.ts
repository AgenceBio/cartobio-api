import config from '../../../src/config/env.js'
import { findStatsByOrganisme } from '../../../src/services/mailer/mailer.repository.js'
import {
  sendCertificationComplete,
  sendCertificationCompleteModifie,
  sendRapportHebdo
} from '../../../src/services/mailer/mailer.service.js'

const { transportSendMail } = vi.hoisted(() => ({ transportSendMail: vi.fn() }))

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: transportSendMail })) }
}))

vi.mock('../../../src/services/mailer/mailer.repository.js')

const record = {
  version_name: 'Version <2026>',
  numerobio: '12345',
  record_id: 'rec-1',
  annee_reference_controle: 2026
}

function lastSent(): { to: string; subject: string; html: string } {
  return transportSendMail.mock.calls.at(-1)![0]
}

beforeEach(() => {
  transportSendMail.mockReset()
  transportSendMail.mockResolvedValue({ messageId: 'id' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sendCertificationComplete', () => {
  test("envoie l'attestation disponible avec le lien vers le parcellaire", async () => {
    await sendCertificationComplete(record, 'operateur@test.fr')

    const sent = lastSent()
    expect(sent.to).toBe('operateur@test.fr')
    expect(sent.subject).toBe('CartoBio : votre attestation du parcellaire 2026 est disponible')
    expect(sent.html).toContain(`${config.get('frontendUrl')}/exploitations/12345/rec-1`)
    expect(sent.html).toContain('Version &lt;2026&gt;')
  })
})

describe('sendCertificationCompleteModifie', () => {
  test("envoie l'attestation mise à jour avec le lien vers le parcellaire", async () => {
    await sendCertificationCompleteModifie(record, 'operateur@test.fr')

    const sent = lastSent()
    expect(sent.subject).toBe('CartoBio : votre attestation du parcellaire 2026 a été mise à jour')
    expect(sent.html).toContain(`${config.get('frontendUrl')}/exploitations/12345/rec-1`)
    expect(sent.html).toContain('Version &lt;2026&gt;')
  })
})

describe('sendRapportHebdo', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 12))
  })

  test('interroge les statistiques de la semaine précédente complète', async () => {
    vi.mocked(findStatsByOrganisme).mockResolvedValue(null)

    await sendRapportHebdo(1, 'oc@test.fr', 'Ecocert')

    expect(findStatsByOrganisme).toHaveBeenCalledWith(1, new Date('2026-10-26'), new Date('2026-11-01T23:59:59'))
  })

  test('affiche les compteurs, la période et le lien vers les imports', async () => {
    vi.mocked(findStatsByOrganisme).mockResolvedValue({
      organismeCertificateur: 1,
      totalRecu: 17,
      totalAcceptes: 11,
      totalRefuses: 6
    })

    await sendRapportHebdo(1, 'oc@test.fr', 'Ecocert & Co')

    const sent = lastSent()
    expect(sent.to).toBe('oc@test.fr')
    expect(sent.subject).toBe('CartoBio : Bilan hebdomadaire des envois API : du 26/10/2026 au 01/11/2026')
    expect(sent.html).toContain('Nombre d’objets envoyés : 17<')
    expect(sent.html).toContain('Nombre d’objets traités : 11<')
    expect(sent.html).toContain('Nombre d’objets rejetés : 6<')
    expect(sent.html).toContain('Du 26/10/2026 au 01/11/2026')
    expect(sent.html).toContain('Ecocert &amp; Co')
    expect(sent.html).toContain(
      `${config.get('frontendUrl')}/api/v3/import/parcellaire-imports?from=2026-10-26&amp;to=2026-11-01&amp;withRejected=true`
    )
  })

  test("affiche des compteurs à zéro quand l'organisme n'a rien envoyé", async () => {
    vi.mocked(findStatsByOrganisme).mockResolvedValue(null)

    await sendRapportHebdo(1, 'oc@test.fr', 'Ecocert')

    const { html } = lastSent()
    expect(html).toContain('Nombre d’objets envoyés : 0<')
    expect(html).toContain('Nombre d’objets traités : 0<')
    expect(html).toContain('Nombre d’objets rejetés : 0<')
  })
})
