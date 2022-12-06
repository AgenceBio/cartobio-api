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
  await db.createTable('rpg_bio', {
    pacage: {
      type: 'string',
      length: 9
    }
  })

  return db.addIndex('rpg_bio', 'pacage_idx', ['pacage'], false)
}

exports.down = function (db) {
  return db.dropTable('rpg_bio')
}

exports._meta = {
  version: 1
}
