'use strict';

var dbm;
var type;
var seed;


exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function(db) {
  await db.addColumn('cartobio_parcelles', 'deleted_at', {
    type: 'datetime',
    notNull: false
  });
};

exports.down = async function(db) {
  await db.removeColumn('cartobio_parcelles', 'deleted_at');
};

exports._meta = {
  "version": 1
};
