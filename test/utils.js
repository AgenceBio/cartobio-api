const db = require('../lib/db')
const record = require('../lib/providers/__fixtures__/record.json')
const parcelles = require('../lib/providers/__fixtures__/parcelles.json')

module.exports.loadRecordFixture = async function () {
  await db.query(
    /* sql */`
      INSERT INTO cartobio_operators
      (record_id, version_name, numerobio, certification_state, audit_date, audit_history, metadata)
      VALUES
      ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      `,
    [
      record.record_id,
      record.version_name,
      record.numerobio,
      record.certification_state,
      record.audit_date,
      JSON.stringify(record.audit_history),
      record.metadata
    ]
  )

  for (let i = 0; i < parcelles.length; i++) {
    const parcelle = parcelles[i]
    await db.query(
      /* sql */`
        INSERT INTO cartobio_parcelles
        (record_id, id, geometry, commune, cultures)
        VALUES
        ($1, $2, $3::geometry, $4, $5::jsonb)
        `,
      [
        record.record_id,
        parcelle.id,
        parcelle.geometry,
        parcelle.commune,
        JSON.stringify(parcelle.cultures)
      ]
    )
  }
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
