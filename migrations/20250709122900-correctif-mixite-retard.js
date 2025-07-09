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
    /*sql*/
 `   WITH allRI AS (
      SELECT record_id
      FROM cartobio_operators co
      WHERE annee_reference_controle IN (2025, 2024) AND certification_state = 'CERTIFIED'
        AND mixite = 'MIXTE'
        AND NOT EXISTS (
            SELECT 1 FROM cartobio_parcelles cp
            WHERE cp.record_id = co.record_id AND cp.conversion_niveau = 'CONV'
        )
      UNION
      SELECT record_id
      FROM cartobio_operators co
      WHERE annee_reference_controle IN (2025, 2024) AND certification_state = 'CERTIFIED'
        AND mixite IN ('ABCONV', 'AB')
        AND EXISTS (
            SELECT 1 FROM cartobio_parcelles cp
            WHERE cp.record_id = co.record_id AND cp.conversion_niveau = 'CONV'
        )
      UNION
      SELECT record_id
      FROM cartobio_operators co
      WHERE annee_reference_controle IN (2025, 2024) AND certification_state = 'CERTIFIED'
        AND mixite = 'ABCONV'
        AND NOT EXISTS (
            SELECT 1 FROM cartobio_parcelles cp
            WHERE cp.record_id = co.record_id AND cp.conversion_niveau IN ('C1', 'C2', 'C3')
        )
      UNION
      SELECT record_id
      FROM cartobio_operators co
      WHERE annee_reference_controle IN (2025, 2024) AND certification_state = 'CERTIFIED'
        AND mixite = 'AB'
        AND EXISTS (
            SELECT 1 FROM cartobio_parcelles cp
            WHERE cp.record_id = co.record_id AND cp.conversion_niveau IN ('C1', 'C2', 'C3')
        )
  ),
  mixiteresult AS (
      SELECT
          co.record_id,
          CASE
              WHEN COUNT(
                      CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END
                   ) = COUNT(cp.record_id) THEN 'AB'
              WHEN (
                      COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0)
                    + COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0)
                    + COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0)
                    + COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)
                   ) = COUNT(cp.record_id) THEN 'ABCONV'
              WHEN COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) >= 1 THEN 'MIXTE'
              ELSE NULL
          END AS mixite
      FROM
          cartobio_operators co
          JOIN allRI a ON co.record_id = a.record_id
          LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
      GROUP BY
          co.record_id
  )

  UPDATE cartobio_operators c
  SET mixite = m.mixite
  FROM mixiteresult m
  JOIN allRI a ON c.record_id = a.record_id
  WHERE c.record_id = m.record_id;
  `
  )
};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
