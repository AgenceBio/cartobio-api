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

exports.up = async function (db) {
  await db.runSql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
  await db.runSql('ALTER TABLE "cartobio_operators" DROP CONSTRAINT IF EXISTS "cartobio_operators_pkey" ')
  await db.runSql('ALTER TABLE "cartobio_operators" DROP CONSTRAINT IF EXISTS "cartobio_operators_numerobio_key"')
  await db.renameColumn('cartobio_operators', 'numerobio', 'operator_id')
  await db.addColumn('cartobio_operators', 'record_id', {
    /* eslint-disable-next-line no-new-wrappers */
    type: 'uuid',
    // primaryKey: true,
    /* eslint-disable-next-line no-new-wrappers */
    defaultValue: new String('uuid_generate_v4()')
  })
  await db.runSql('ALTER TABLE "cartobio_operators" ADD CONSTRAINT "cartobio_operators_record_id_pkey" PRIMARY KEY (record_id)')
  await db.addColumn('cartobio_operators', 'created_at', {
    type: 'datetime',
    timezone: true,
    defaultValue: {
      special: 'CURRENT_TIMESTAMP'
    }
  })
  await db.addColumn('cartobio_operators', 'updated_at', {
    type: 'datetime',
    timezone: true,
    defaultValue: {
      special: 'CURRENT_TIMESTAMP'
    }
  })
  await db.addColumn('cartobio_operators', 'certification_state', {
    type: 'string',
    defaultValue: 'OPERATOR_DRAFT'
  })
  await db.addColumn('cartobio_operators', 'numerobio', {
    type: 'string',
    length: 10
  })
  await db.addIndex('cartobio_operators', 'numerobio', ['numerobio'], false)
  await db.addColumn('cartobio_operators', 'oc_id', {
    type: 'int',
    unsigned: true
  })
  await db.addColumn('cartobio_operators', 'oc_label', {
    type: 'string'
  })
  await db.addColumn('cartobio_operators', 'events', {
    type: 'jsonb',
    /* eslint-disable-next-line no-new-wrappers,quotes */
    defaultValue: new String(`'[]'::jsonb`)
  })
}

exports.down = async function (db) {
  await db.removeColumn('cartobio_operators', 'created_at')
  await db.removeColumn('cartobio_operators', 'updated_at')
  await db.removeColumn('cartobio_operators', 'certification_state')
  await db.removeColumn('cartobio_operators', 'events')
  await db.removeColumn('cartobio_operators', 'numerobio')
  await db.runSql('DROP INDEX IF EXISTS "numerobio"')
  await db.runSql('ALTER TABLE "cartobio_operators" DROP CONSTRAINT IF EXISTS "cartobio_operators_numerobio_key"')
  await db.removeColumn('cartobio_operators', 'record_id')
  await db.runSql('ALTER TABLE "cartobio_operators" DROP CONSTRAINT IF EXISTS "cartobio_operators_record_id_pkey"')
  await db.removeColumn('cartobio_operators', 'oc_id')
  await db.removeColumn('cartobio_operators', 'oc_label')
  await db.renameColumn('cartobio_operators', 'operator_id', 'numerobio')
  await db.changeColumn('cartobio_operators', 'numerobio', {
    type: 'int',
    primaryKey: true,
    unique: true,
    unsigned: true,
    notNull: true
  })

  await db.runSql('DROP EXTENSION "uuid-ossp"')
}

exports._meta = {
  version: 2
}
