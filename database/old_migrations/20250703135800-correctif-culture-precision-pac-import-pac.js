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
    UPDATE
      cartobio_parcelles
    SET
      code_culture_pac = res.code_culture,
      code_precision_pac = res.code_precision
    FROM
      (
    WITH
    imported_parcellaire AS (
      SELECT
        co.record_id,
        co.numerobio
      FROM
        cartobio_operators co
      WHERE
        co.metadata->>'source' = 'telepac'
        AND co.metadata->>'campagne' = '2025'),
      parcelle_import_pac AS (
      SELECT
        p.record_id,
        jsonb_array_elements(ip.record->'parcelles'->'features')->>'id' AS id,
        jsonb_array_elements(ip.record->'parcelles'->'features')->'properties'->>'TYPE' AS code_culture,
        jsonb_array_elements(ip.record->'parcelles'->'features')->'properties'->>'CODE_VAR' AS code_precision
      FROM
        import_pac ip
      JOIN imported_parcellaire p ON
        p.numerobio = ip.numerobio )
      SELECT
        pip.id,
        pip.code_culture,
        pip.code_precision
      FROM
        cartobio_parcelles cp
      JOIN parcelle_import_pac pip ON
        pip.id = cp.id AND pip.record_id = cp.record_id 
      WHERE
        cp.code_culture_pac IS NULL
        AND cp.code_precision_pac IS NULL) AS res
    WHERE
      cartobio_parcelles.id = res.id;
  `)
};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
