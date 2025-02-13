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
	    cartobio_operators
    SET
      annee_reference_controle = coalesce ( greatest(DATE_PART('year',
      certification_date_debut),
      DATE_PART('year',
      audit_date)),
      DATE_PART('year',
      created_at));
  `)
  await db.runSql(
    /* sql */`
    UPDATE cartobio_operators
    SET annee_reference_controle=(metadata->>'anneeReferenceControle')::int
    WHERE
      metadata->'anneeReferenceControle' is not null AND created_at > '2024-01-12';
  `)


};

exports.down = async function(db) {
  await db.runSql(`
    UPDATE cartobio_operators
    SET annee_reference_controle=DATE_PART('year', created_at)
  `);
  await db.runSql(`
    UPDATE cartobio_operators
    SET annee_reference_controle=(metadata->>'anneeReferenceControle')::int
    WHERE
      metadata->'anneeReferenceControle' is not null AND created_at > '2024-01-12' 
  `);

};

exports._meta = {
  "version": 1
};
