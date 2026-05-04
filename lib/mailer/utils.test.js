jest.mock('./index.js', () => ({
  sendMail: jest.fn().mockResolvedValue({ messageId: 'test' })
}))

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('<html>{{version_name}} {{url}}</html>')
}))

jest.mock('../config.js', () => ({
  get: jest.fn().mockReturnValue('http://localhost:3000')
}))

const { sendCertificationComplete } = require('./utils')
const { sendMail } = require('./index.js')

const mockRecord = {
  record_id: '04389d05-105e-40c8-bcd9-a7c72f709089',
  numerobio: 12345,
  audit_date: '2024-01-01',
  certification_date_fin: '2025-01-01',
  version_name: 'Version 12345',
  annee_reference_controle: 2024
}

describe('mailerService', () => {
  beforeEach(() => {
    sendMail.mockClear()
  })

  test('sendCertificationComplete envoie le bon sujet', async () => {
    await sendCertificationComplete(mockRecord, 'test@example.com')

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        subject: expect.stringContaining(String(mockRecord.annee_reference_controle)) // corrigé : annee_reference_controle et non numerobio
      })
    )
  })

  test('sendCertificationComplete génère un HTML', async () => {
    await sendCertificationComplete(mockRecord, 'test@example.com')

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.any(String)
      })
    )
  })
})
