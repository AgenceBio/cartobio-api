'use strict';

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function (db) {
  await db.addColumn('cartobio_operators', 'date_derniere_notif', {
    type: 'timestamp',
    notNull: false
  });

  await db.runSql(`
    UPDATE cartobio_operators
    SET date_derniere_notif = updated_at
    WHERE certification_state = 'CERTIFIED'
  `);
};

exports.down = async function (db) {
  await db.removeColumn('cartobio_operators', 'date_derniere_notif');
};

exports._meta = {
  version: 1
};