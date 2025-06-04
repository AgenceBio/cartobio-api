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
//   await db.runSql(/* sql */ `
//     UPDATE cartobio_parcelles_backup
//     SET cultures = (
//     SELECT jsonb_agg(
//         CASE elem->>'CPF'
//             WHEN '02.10.2003' THEN jsonb_set(elem, '{CPF}', '"02.10.3"')
//             WHEN '01.12.2001' THEN jsonb_set(elem, '{CPF}', '"02.12.1"')
//             ELSE elem
//         END
//     )
//     FROM jsonb_array_elements(cultures) AS elem
// )
// WHERE cultures IS NOT NULL
//   AND (cultures::text LIKE '%02.10.2003%' OR cultures::text LIKE '%01.12.2001%');
//   `);
};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
