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
  await db.runSql(/* sql */ `
    UPDATE cartobio_parcelles cp
    SET id = floor(random() * 281474976710655 + 1)::varchar
    FROM cartobio_operators co
    WHERE not(cp.id ~ '^[0-9\.]+$')
    AND cp.record_id  = co.record_id
  `)
};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
