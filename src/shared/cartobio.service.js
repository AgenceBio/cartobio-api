'use strict'

const repository = require('./cartobio.repository.js')
const { normalizeRecord, normalizeRecordSummary } = require('./outputs/record.js')

async function createOrUpdateOperatorRecord (record, context = {}, client) {
  return repository.createOrUpdateOperatorRecord(record, context, client)
}

async function getRecords (numeroBio) {
  const records = await repository.findRecords(numeroBio)
  return records.map(normalizeRecordSummary)
}

async function getRecord (recordId, user = null) {
  const record = await repository.findRecord(recordId)
  if (!record) return null

  const recordWithParcelles = await joinRecordParcelles(record, user?.id)
  return normalizeRecord(recordWithParcelles)
}

async function joinRecordParcelles (record, userId = null) {
  return repository.findRecordParcelles(record, userId)
}

module.exports = {
  createOrUpdateOperatorRecord,
  getRecords,
  getRecord,
  joinRecordParcelles,
}
