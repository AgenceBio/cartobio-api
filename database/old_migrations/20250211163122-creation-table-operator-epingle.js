'use strict';

var dbm;
var type;
var seed;

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function(db) {
  await db.runSql(
    `CREATE TABLE operateurs_epingles (
      numerobio integer,
      user_id integer,
      PRIMARY KEY(numerobio, user_id)
    )`
  )
  await db.addColumn('operateurs_epingles', 'created_at', {
    type: 'datetime',
    timezone: true,
    defaultValue: {
      special: 'CURRENT_TIMESTAMP'
    }
  })
};

exports.down = function (db) {
  db.dropTable('operateurs_epingles')
};

exports._meta = {
  "version": 1
};
