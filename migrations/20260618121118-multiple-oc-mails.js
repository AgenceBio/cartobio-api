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

exports.up = function(db) {
  return db.runSql(`
    ALTER TABLE organisme_certificateur RENAME COLUMN email TO email_old;

    ALTER TABLE organisme_certificateur ADD COLUMN emails text[] NOT NULL DEFAULT '{}';

    UPDATE organisme_certificateur
    SET emails = ARRAY[email_old]
    WHERE email_old IS NOT NULL;

    ALTER TABLE organisme_certificateur DROP COLUMN email_old;
  `)
};

exports.down = function(db) {
  return db.runSql(`
    ALTER TABLE organisme_certificateur ADD COLUMN email text;

    UPDATE organisme_certificateur
    SET email = emails[1];

    ALTER TABLE organisme_certificateur DROP COLUMN emails;
  `)
};

exports._meta = {
  "version": 1
};