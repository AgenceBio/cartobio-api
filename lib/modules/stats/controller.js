'use strict'

const repo = require('./repository')

function getPreviousPeriod (from, to) {
  const fromDate = new Date(from)
  const toDate = new Date(to)
  const duration = toDate - fromDate

  const prevTo = new Date(fromDate.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - duration)

  return { prevFrom, prevTo }
}

async function getBilanPeriode (req, res) {
  const { organismeCertificateur } = req.params
  const { from, to, withComparison } = req.query

  const current = await repo.getBilanPeriodeRepo(
    organismeCertificateur,
    new Date(from),
    new Date(`${to}T23:59:59`)
  )

  let previous = null

  if (withComparison === 'true') {
    const { prevFrom, prevTo } = getPreviousPeriod(from, to)

    previous = await repo.getBilanPeriodeRepo(
      organismeCertificateur,
      prevFrom,
      prevTo
    )
  }

  return res.send({ current, previous })
}

async function getBilanParGranularite (req, res) {
  const { organismeCertificateur } = req.params
  const { from, to, granularity } = req.query

  const data = await repo.getBilanParGranulariteRepo(
    organismeCertificateur,
    new Date(from),
    new Date(`${to}T23:59:59`),
    granularity
  )

  return res.send({ data })
}

async function getResumeSemaine (req, res) {
  const { organismeCertificateur } = req.params

  const data = await repo.getResumeSemaineRepo(organismeCertificateur)

  return res.send({ data })
}

async function getTableauBilan (req, res) {
  const { organismeCertificateur } = req.params

  const { from, to, errorOnly, page = 1, limit = 20 } = req.query

  const data = await repo.getTableauBilanRepo(organismeCertificateur, {
    from,
    to,
    errorOnly: errorOnly === 'true',
    page: Number(page),
    limit: Number(limit)
  })

  return res.send({ data })
}

async function getHistoriqueImports (req, res) {
  const { organismeCertificateur } = req.params
  const { from, to, page = 1, limit = 20 } = req.query

  const data = await repo.getHistoriqueImportsRepo(organismeCertificateur, {
    from,
    to,
    page: Number(page),
    limit: Number(limit)
  })

  return res.send({ data })
}

async function getPayloadImport (req, res) {
  const { organismeCertificateur, jobId } = req.params

  const payload = await repo.getPayloadImportRepo(organismeCertificateur, jobId)

  return res.send({ data: payload })
}

async function getTableauErreurs (req, res) {
  const { organismeCertificateur } = req.params
  const { from, to, page = 1, limit = 20 } = req.query

  const data = await repo.getTableauErreursRepo(organismeCertificateur, {
    from,
    to,
    page: Number(page),
    limit: Number(limit)
  })

  return res.send({ data })
}

async function getEnvoisRefuses (req, res) {
  const { organismeCertificateur } = req.params
  const { from, to } = req.query

  const data = await repo.getEnvoisRefusesRepo(
    organismeCertificateur,
    new Date(from),
    new Date(`${to}T23:59:59`)
  )

  return res.send({ data })
}

module.exports = {
  getBilanPeriode,
  getBilanParGranularite,
  getResumeSemaine,
  getTableauBilan,
  getHistoriqueImports,
  getPayloadImport,
  getTableauErreurs,
  getEnvoisRefuses
}