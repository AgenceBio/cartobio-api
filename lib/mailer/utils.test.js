const { describe, test, expect, vi } = require('vitest')
const mailerIndex = require('./index')
const { sendCertificationComplete } = require('./mailer.service')

vi.spyOn(mailerIndex, 'sendMail').mockResolvedValue({ messageId: 'test' })

const mockRecord = {
  numerobio: 12345,
  audit_date: '2024-01-01',
  certification_date_fin: '2025-01-01'
}

describe('mailerService', () => {
  test('sendCertificationComplete envoie le bon sujet', async () => {
    await sendCertificationComplete(mockRecord, 'test@example.com')

    expect(mailerIndex.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        subject: expect.stringContaining(String(mockRecord.numerobio))
      })
    )
  })

  test('sendCertificationComplete génère un HTML', async () => {
    await sendCertificationComplete(mockRecord, 'test@example.com')

    expect(mailerIndex.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.any(String)
      })
    )
  })
})
