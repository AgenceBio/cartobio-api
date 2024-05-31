const db = require('../lib/db')
const records = require('../lib/providers/__fixtures__/records.json')
const parcelles = require('../lib/providers/__fixtures__/parcelles.json')

module.exports.loadRecordFixture = async function () {
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    await db.query(
      /* sql */`
        INSERT INTO cartobio_operators
        (record_id, version_name, numerobio, certification_state, certification_date_debut,
         certification_date_fin, audit_date, audit_notes, audit_demandes, audit_history, metadata, oc_id,
         oc_label, updated_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, now(), now())
      `,
      [
      /*  $1 */ record.record_id,
        /*  $2 */ record.version_name,
        /*  $3 */ record.numerobio,
        /*  $4 */ record.certification_state,
        /*  $5 */ record.certification_date_debut,
        /*  $6 */ record.certification_date_fin,
        /*  $7 */ record.audit_date,
        /*  $8 */ record.audit_notes,
        /*  $9 */ record.audit_demandes,
        /* $10 */ JSON.stringify(record.audit_history),
        /* $11 */ record.metadata,
        /* $12 */ record.oc_id,
        /* $13 */ record.oc_label
      ]
    )
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    for (let j = 0; j < parcelles.length; j++) {
      const parcelle = parcelles[j]
      await db.query(
        /* sql */`
          INSERT INTO cartobio_parcelles
          (record_id, id, geometry, commune, cultures, created, conversion_niveau, engagement_date, numero_ilot_pac, numero_parcelle_pac, commentaire)
          VALUES
          ($1, $2, $3::geometry, $4, $5::jsonb, 'now', $6, $7, $8, $9, $10)
          `,
        [
          record.record_id,
          parcelle.id,
          parcelle.geometry,
          parcelle.commune,
          JSON.stringify(parcelle.cultures),
          parcelle.conversion_niveau,
          parcelle.engagement_date,
          parcelle.numero_ilot_pac,
          parcelle.numero_parcelle_pac,
          parcelle.commentaire
        ]
      )
    }
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
