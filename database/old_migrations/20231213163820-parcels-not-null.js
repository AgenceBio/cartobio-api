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
  await db.runSql('UPDATE cartobio_operators SET parcelles = \'{"type": "FeatureCollection", "features": []}\'::jsonb WHERE parcelles IS NULL')
  return db.runSql('ALTER TABLE "cartobio_operators" ALTER COLUMN "parcelles" SET NOT NULL')
}

exports.down = function (db) {
  return null
}

exports._meta = {
  version: 1
}
