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

exports.up = (db) => db.runSql(`
  CREATE TABLE revoked_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    user_id    TEXT,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX revoked_tokens_expires_at_idx ON revoked_tokens (expires_at);
`)

exports.down = (db) => db.runSql('DROP TABLE revoked_tokens;')

exports._meta = {
  "version": 1
};
