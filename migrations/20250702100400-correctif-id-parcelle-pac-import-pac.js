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
      id = res.correct_id
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
        jsonb_array_elements(ip.record->'parcelles'->'features')->'properties'->>'NUMERO_P' AS num_parcelle,
        jsonb_array_elements(ip.record->'parcelles'->'features')->'properties'->>'NUMERO_I' AS num_ilot,
        ip.pacage
      FROM
        import_pac ip
      JOIN imported_parcellaire p ON
        p.numerobio = ip.numerobio )
      SELECT
        pip.id AS correct_id , cp.id AS random_id
      FROM
        cartobio_parcelles cp
      JOIN parcelle_import_pac pip ON
         pip.num_parcelle = cp.numero_parcelle_pac and pip.num_ilot = cp.numero_ilot_pac and pip.pacage = cp.numero_pacage AND pip.record_id = cp.record_id
      WHERE
        pip.id != cp.id) AS res
    WHERE
      cartobio_parcelles.id = res.random_id;
  `)
};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
