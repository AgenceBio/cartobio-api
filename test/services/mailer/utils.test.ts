import path from 'node:path'
import config from '../../../src/config/env.js'
import { MAIL_TEMPLATES_DIR } from '../../../src/shared/paths.js'
import {
  formatDateFr,
  getLastWeekDates,
  operatorRecordUrl,
  renderTemplate,
  sendMail
} from '../../../src/services/mailer/mailer.utils.js'

const { transportSendMail } = vi.hoisted(() => ({ transportSendMail: vi.fn() }))

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: transportSendMail })) }
}))

describe('renderTemplate', () => {
  test('remplace toutes les variables du template', () => {
    const html = renderTemplate('RAPPORT_HEBDO_API', {
      date_debut: '26/10/2026',
      date_fin: '01/11/2026',
      nb_envoye: 12,
      nb_traite: 10,
      nb_error: 2,
      oc_label: 'Ecocert',
      url: 'https://cartobio.test/imports'
    })

    expect(html).not.toMatch(/{{\s*\w+\s*}}/)
    expect(html).toContain('26/10/2026')
    expect(html).toContain('01/11/2026')
    expect(html).toContain('Ecocert')
    expect(html).toContain('https://cartobio.test/imports')
  })

  test('échappe le HTML des variables', () => {
    const html = renderTemplate('CERTIFICATION', {
      version_name: '<script>alert("x")</script> & co',
      url: 'https://cartobio.test/?a=1&b=2'
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co')
    expect(html).toContain('https://cartobio.test/?a=1&amp;b=2')
  })

  test("n'interprète pas les motifs de remplacement spéciaux dans les valeurs", () => {
    const html = renderTemplate('CERTIFICATION', { version_name: "$& $' $1", url: '' })

    expect(html).toContain('$&amp; $&#39; $1')
  })

  test('laisse en place les variables non fournies', () => {
    const html = renderTemplate('CERTIFICATION', { version_name: 'v1' })

    expect(html).toMatch(/{{\s*url\s*}}/)
  })

  test("lève une erreur si le template n'existe pas", () => {
    expect(() => renderTemplate('INEXISTANT', {})).toThrow(/ENOENT/)
  })
})

describe('getLastWeekDates', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test.each([
    ['un mercredi', new Date(2026, 10, 4, 12), '2026-10-26', '2026-11-01'],
    ['un lundi', new Date(2026, 10, 2, 12), '2026-10-26', '2026-11-01'],
    ['un dimanche', new Date(2026, 10, 8, 12), '2026-10-26', '2026-11-01'],
    ['un changement de mois et d’année', new Date(2026, 0, 7, 12), '2025-12-29', '2026-01-04']
  ])('retourne le lundi et le dimanche de la semaine précédente pour %s', (_, now, dateDebut, dateFin) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)

    expect(getLastWeekDates()).toEqual({ dateDebut, dateFin })
  })
})

describe('formatDateFr', () => {
  test('formate une date ISO au format JJ/MM/AAAA', () => {
    expect(formatDateFr('2026-01-04')).toBe('04/01/2026')
  })
})

describe('operatorRecordUrl', () => {
  test("construit l'url de la fiche exploitation", () => {
    expect(operatorRecordUrl('12345', 'abc')).toBe(`${config.get('frontendUrl')}/exploitations/12345/abc`)
  })
})

describe('sendMail', () => {
  beforeEach(() => {
    transportSendMail.mockReset()
    transportSendMail.mockResolvedValue({ messageId: 'id' })
  })

  test("envoie depuis l'adresse no-reply avec la signature et les pièces jointes par défaut", async () => {
    const info = await sendMail({ to: 'oc@test.fr', subject: 'Sujet', html: '<p>Bonjour</p>' })

    expect(info).toEqual({ messageId: 'id' })
    expect(transportSendMail).toHaveBeenCalledTimes(1)
    const sent = transportSendMail.mock.calls[0]![0]
    expect(sent.from).toBe('no-reply@agencebio.org')
    expect(sent.to).toBe('oc@test.fr')
    expect(sent.subject).toBe('Sujet')
    expect(sent.html.startsWith('<p>Bonjour</p>')).toBe(true)
    expect(sent.html).toContain('cid:signature')
    expect(sent.html).toContain(`href=${config.get('frontendUrl')}`)
    expect(sent.attachments).toEqual([
      { filename: 'logo.png', path: path.join(MAIL_TEMPLATES_DIR, 'assets/banniere_agence_bio.png'), cid: 'logo' },
      { filename: 'signature.png', path: path.join(MAIL_TEMPLATES_DIR, 'assets/signature.png'), cid: 'signature' }
    ])
  })

  test('place les pièces jointes fournies avant celles par défaut sans modifier le tableau passé', async () => {
    const attachments = [{ filename: 'rapport.pdf', content: 'pdf' }]

    await sendMail({ to: ['a@test.fr', 'b@test.fr'], subject: 'Sujet', html: '', attachments })
    await sendMail({ to: 'c@test.fr', subject: 'Sujet', html: '', attachments })

    expect(attachments).toEqual([{ filename: 'rapport.pdf', content: 'pdf' }])
    for (const [sent] of transportSendMail.mock.calls) {
      expect(sent.attachments.map(({ filename }: { filename: string }) => filename)).toEqual([
        'rapport.pdf',
        'logo.png',
        'signature.png'
      ])
    }
    expect(transportSendMail.mock.calls[0]![0].to).toEqual(['a@test.fr', 'b@test.fr'])
  })

  test("propage l'erreur du transport", async () => {
    transportSendMail.mockRejectedValue(new Error('SMTP indisponible'))

    await expect(sendMail({ to: 'oc@test.fr', subject: 'Sujet', html: '' })).rejects.toThrow('SMTP indisponible')
  })
})
