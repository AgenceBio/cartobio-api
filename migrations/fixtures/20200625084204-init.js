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

const fixtures = [
  [270, {}],
  [385, { numeroPacage: '' }],
  [28, { numeroPacage: '033167666' }]
]

exports.up = function (db) {
  return Promise.all([
    // ecocert, ocid:1
    db.insert('cartobio_operators', ['numerobio', 'metadata'], fixtures[0]),
    db.insert('cartobio_operators', ['numerobio', 'metadata'], fixtures[1]),
    db.insert('cartobio_operators', ['numerobio', 'metadata'], fixtures[2])
  ])
}

exports.down = function (db) {
  return db.runSql('delete from cartobio_operators where numerobio in (?, ?, ?)', [
    fixtures[0][0],
    fixtures[1][0],
    fixtures[2][0]
  ])
}
