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
    /* sql */`
    UPDATE
        cartobio_parcelles
    SET
        geometry = ST_GeometryN(geometry,
        1)
    WHERE
        st_geometrytype(geometry) = 'ST_MultiPolygon'
        and st_numgeometries(geometry) = 1;
  `)
};

exports.down = function(db) {
  return null
};

exports._meta = {
  "version": 1
};
