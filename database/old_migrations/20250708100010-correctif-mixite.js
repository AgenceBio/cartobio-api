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
UPDATE
    cartobio_operators co
SET
    mixite = mixiteresult.mixite
FROM
    (
        SELECT
            co.record_id,
            CASE
                WHEN COUNT(
                    CASE
                        WHEN cp.conversion_niveau = 'AB' THEN 1
                        ELSE NULL
                    END
                ) = COUNT(cp.record_id) THEN 'AB'
                WHEN (
                    COALESCE(
                        COUNT(
                            CASE
                                WHEN cp.conversion_niveau = 'C1' THEN 1
                                ELSE NULL
                            END
                        ),
                        0
                    ) + COALESCE(
                        COUNT(
                            CASE
                                WHEN cp.conversion_niveau = 'C2' THEN 1
                                ELSE NULL
                            END
                        ),
                        0
                    ) + COALESCE(
                        COUNT(
                            CASE
                                WHEN cp.conversion_niveau = 'C3' THEN 1
                                ELSE NULL
                            END
                        ),
                        0
                    ) + COALESCE(
                        COUNT(
                            CASE
                                WHEN cp.conversion_niveau = 'AB' THEN 1
                                ELSE NULL
                            END
                        ),
                        0
                    )
                ) = COUNT(cp.record_id) THEN 'ABCONV'
                WHEN COALESCE(
                    COUNT(
                        CASE
                            WHEN cp.conversion_niveau = 'CONV' THEN 1
                            ELSE NULL
                        END
                    ),
                    0
                ) >= 1 THEN 'MIXTE'
                ELSE NULL
            END AS mixite
        FROM
            cartobio_operators co
            LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
        GROUP BY
            co.record_id
    ) AS mixiteresult
WHERE
    co.record_id = mixiteresult.record_id
    AND co.mixite IS NULL
    AND co.certification_state = 'CERTIFIED'`);
};

exports.down = function (db) {
  return null;
};

exports._meta = {
  version: 1,
};
