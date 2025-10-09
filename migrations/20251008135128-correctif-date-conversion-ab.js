"use strict";

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
    /** sql **/`
      UPDATE cartobio_parcelles
      SET engagement_date = '01/01/1900', updated = now()
      WHERE conversion_niveau = 'AB' AND engagement_date IS NULL`
	);

	await db.runSql(
		/** sql **/`
	CREATE OR REPLACE FUNCTION ab_date_fn()
	RETURNS trigger AS $$
	BEGIN
  	IF (NEW.conversion_niveau = 'AB' AND NEW.engagement_date IS NULL) THEN
    	NEW.engagement_date := DATE '1900-01-01';
  	END IF;
  	RETURN NEW;
	END;
	$$ LANGUAGE plpgsql;

	CREATE TRIGGER ab_date
	BEFORE INSERT OR UPDATE ON cartobio_parcelles
	FOR EACH ROW
	EXECUTE FUNCTION ab_date_fn();
`
	)
};

exports.down = function(db) {
	return null;
};

exports._meta = {
	version: 1,
};

