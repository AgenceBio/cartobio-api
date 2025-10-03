"use strict";

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function (db) {
  await db.runSql(/*sql*/ `
WITH parcels AS (
  SELECT
    cp.record_id AS operator_record_id,
    cp.conversion_niveau
  FROM cartobio_parcelles cp
  WHERE not EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cp.cultures) AS elem
    WHERE elem->>'CPF' IN ('01.99.10.1','01.99.10.2')
  )
),
mixiteresult AS (
  SELECT
    operator_record_id AS record_id,
    CASE
      WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'AB') = COUNT(*) THEN 'AB'
      WHEN COUNT(*) FILTER (WHERE conversion_niveau IN ('C1','C2','C3','AB')) = COUNT(*) THEN 'ABCONV'
      WHEN COUNT(*) FILTER (WHERE conversion_niveau = 'CONV') >= 1 THEN 'MIXTE'
      ELSE NULL
    END AS mixite
  FROM parcels
  GROUP BY operator_record_id
)
UPDATE cartobio_operators co
SET mixite = m.mixite
FROM mixiteresult m
WHERE co.record_id = m.record_id
  AND co.certification_state = 'CERTIFIED';
`);
};

exports.down = function (db) {
  return null;
};

exports._meta = {
  version: 1,
};
