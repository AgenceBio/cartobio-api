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
    fid: {
      type: 'int',
      primaryKey: true,
      notNull: true,
      unsigned: true
    },
    pacage: {
      type: 'string',
      length: 9
    },
    geom: 'geometry',
    num_ilot: 'int',
    num_parcel: 'int',
    bio: 'int',
    code_cultu: {
      type: 'string',
      length: 3
    },
    surf_adm: 'real',
    precision: {
      type: 'string',
      length: 9
    },
    reconver_p: 'int',
    retournmt_: 'int',
    semence: 'int',
    dest_ichn: {
      type: 'string',
      length: 1
    },
    culture_d1: {
      type: 'string',
      length: 3
    },
    culture_d2: {
      type: 'string',
      length: 3
    },
    engagement: {
      type: 'string',
      length: 2
    },
    maraichage: 'int',
    agroforest: {
      type: 'string',
      length: 5
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
