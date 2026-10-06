'use strict'

let dbm
let type
let seed

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate
  type = dbm.dataType
  seed = seedLink
}

exports.up = function (db) {
  db.runSql('DROP TRIGGER update_communes ON cartobio_operators')

  db.runSql(/* sql */`
    CREATE TRIGGER update_communes
    BEFORE UPDATE OF parcelles OR INSERT ON cartobio_operators
    FOR EACH ROW
    EXECUTE FUNCTION update_communes()
  `)

  db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION has_geometry() RETURNS trigger AS $$
    BEGIN
        IF EXISTS (
          SELECT 1
          FROM jsonb_array_elements(NEW.parcelles->'features') AS new_features
          LEFT JOIN jsonb_array_elements(OLD.parcelles->'features') AS old_features
          ON (new_features->>'id')::bigint = (old_features ->>'id')::bigint
          WHERE new_features->'geometry' IS NULL AND old_features->'geometry' IS NULL
        ) THEN
          RAISE EXCEPTION 'No geometry';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  db.runSql(
    /* sql */`
    CREATE TRIGGER has_geometry
    AFTER UPDATE OF parcelles OR INSERT ON cartobio_operators
    FOR EACH ROW
    EXECUTE FUNCTION has_geometry()
  `)

  return null
}

exports.down = function (db) {
  db.runSql('DROP TRIGGER update_communes ON cartobio_operators')

  db.runSql(/* sql */`
    CREATE TRIGGER update_communes
    BEFORE UPDATE OF parcelles ON cartobio_operators
    FOR EACH ROW
    EXECUTE FUNCTION update_communes()
  `)

  db.runSql('DROP TRIGGER has_geometry ON cartobio_operators')
  db.runSql('DROP FUNCTION has_geometry()')

  return null
}

exports._meta = {
  version: 1
}
