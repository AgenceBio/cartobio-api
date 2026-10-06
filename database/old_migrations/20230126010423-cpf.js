'use strict'

var dbm
var type
var seed

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate
  type = dbm.dataType
  seed = seedLink
}

exports.up = async function (db) {
  await db.createTable('correspondance_pac_cpf', {
    pac: {
      type: 'string',
      length: 3
    },
    cpf: 'string'
  })

  return db.addIndex('correspondance_pac_cpf', 'pac_cpf_idx', ['pac', 'cpf'], false)
}

exports.down = function (db) {
  // it might have been already dropped in 20230724153800-cpf-drop.js
  return db.dropTable('correspondance_pac_cpf', { ifExists: true })
}

exports._meta = {
  version: 1
}
