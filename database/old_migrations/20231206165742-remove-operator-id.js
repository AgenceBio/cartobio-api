'use strict'

let dbm
let type
let seed

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
  await db.removeIndex('cartobio_operators', 'cartobio_operators_operator_id_idx')
  await db.removeColumn('cartobio_operators', 'operator_id')
  await db.changeColumn('cartobio_operators', 'oc_id', {
    type: 'int',
    unsigned: true,
    notNull: false
  })
}

exports.down = async function (db) {
  await db.addColumn('cartobio_operators', 'operator_id', {
    type: 'int',
    autoIncrement: false,
    unique: true,
    unsigned: true,
    notNull: false
  })

  await db.addIndex('cartobio_operators', 'cartobio_operators_operator_id_idx', ['operator_id'], true)
}

exports._meta = {
  version: 1
}
