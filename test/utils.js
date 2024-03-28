const db = require('../lib/db')
const records = require('../lib/providers/__fixtures__/records.json')
const parcelles = require('../lib/providers/__fixtures__/parcelles.json')

module.exports.loadRecordFixture = async function () {
  await Promise.all(records.map(record => db.query(
    /* sql */`
      INSERT INTO cartobio_operators
      (record_id, version_name, numerobio, certification_state, certification_date_debut, certification_date_fin, audit_date, audit_history, metadata, oc_id, oc_label)
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
      `,
    [
      record.record_id,
      record.version_name,
      record.numerobio,
      record.certification_state,
      record.certification_date_debut,
      record.certification_date_fin,
      record.audit_date,
      JSON.stringify(record.audit_history),
      record.metadata,
      record.oc_id,
      record.oc_label
    ]
  )))

  await Promise.all(records.flatMap(({ record_id: id }) => {
    return parcelles.map(parcelle => {
      return db.query(
        /* sql */`
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures)
          VALUES
          ($1, $2, $3::geometry, $4, $5::jsonb)
          `,
        [
          id,
          parcelle.id,
          parcelle.geometry,
          parcelle.commune,
          JSON.stringify(parcelle.cultures)
        ]
      )
    })
  }))
}

const expectDeepCloseTo = (value) => {
  if (value === null) {
    return null
  }

  // If value is an array, apply recursively to all elements
  if (Array.isArray(value)) {
    return value.map(expectDeepCloseTo)
  }

  // If value is on object, apply recursively to all properties
  if (typeof value === 'object') {
    const result = {}
    for (const key in value) {
      result[key] = expectDeepCloseTo(value[key])
    }

    return result
  }

  // If value is a float number, use toBeCloseTo
  if (typeof value === 'number' && value % 1 !== 0) {
    return expect.closeTo(value)
  }

  return value
}

module.exports.expectDeepCloseTo = expectDeepCloseTo
