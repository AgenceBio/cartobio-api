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
  await db.createTable('cartobio_parcelles', {
    record_id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true
    },
    id: {
      type: 'string',
      notNull: true,
      primaryKey: true
    },
    geometry: {
      type: 'geometry(GEOMETRY, 4326)',
      notNull: true
    },
    commune: {
      type: 'string'
    },
    cultures: {
      type: 'jsonb',
      notNull: true
    },
    conversion_niveau: {
      type: 'string'
    },
    engagement_date: {
      type: 'date'
    },
    commentaire: {
      type: 'string'
    },
    annotations: {
      type: 'jsonb'
    },
    created: {
      type: 'datetime',
      timezone: false
    },
    updated: {
      type: 'datetime',
      timezone: false
    },
    name: {
      type: 'string'
    },
    numero_pacage: {
      type: 'string'
    },
    numero_ilot_pac: {
      type: 'string'
    },
    numero_parcelle_pac: {
      type: 'string'
    },
    reference_cadastre: {
      type: 'text[]'
    }
  })

  await db.addForeignKey('cartobio_parcelles', 'cartobio_operators', 'record_id_foreign', {
    record_id: 'record_id'
  }, {
    onDelete: 'CASCADE',
    onUpdate: 'RESTRICT'
  })

  /** copy data from cartobio_operators.parcelles to cartobio_features */
  await db.runSql(
    `INSERT INTO cartobio_parcelles (
        record_id,
        id,
        geometry,
        commune,
        cultures,
        conversion_niveau,
        engagement_date,
        commentaire,
        annotations,
        created,
        updated,
        name,
        numero_pacage,
        numero_ilot_pac,
        numero_parcelle_pac,
        reference_cadastre
    )
    SELECT DISTINCT ON (cartobio_operators.record_id, feature->>'id')
        cartobio_operators.record_id,
        feature->'id',
        ST_GeomFromGeoJSON(feature->'geometry'),
        feature->'properties'->>'COMMUNE',
        COALESCE(feature->'properties'->'cultures', (
            SELECT CASE
                WHEN feature->'properties'->>'TYPE' IS NOT NULL OR feature->'properties'->>'CPF' IS NOT NULL
                THEN
                    jsonb_build_array(
                        jsonb_build_object(
                            'id', 1,
                            'CPF', feature->'properties'->>'CPF',
                            'TYPE', feature->'properties'->>'TYPE',
                            'surface', feature->'properties'->>'SURF',
                            'variete', feature->'properties'->>'variete'
                        )
                    )
                ELSE
                    jsonb_build_array()
                END
        )),
        feature->'properties'->>'conversion_niveau',
        NULLIF(feature->'properties'->>'engagement_date', '')::date,
        feature->'properties'->>'commentaire',
        feature->'properties'->'annotations',
        to_timestamp((0 || (feature->'properties'->>'createdAt'))::bigint / 1000),
        to_timestamp((0 || (feature->'properties'->>'updatedAt'))::bigint / 1000),
        COALESCE(feature->'properties'->>'name', feature->'properties'->>'NOM'),
        feature->'properties'->>'PACAGE',
        feature->'properties'->>'NUMERO_I',
        feature->'properties'->>'NUMERO_P',
        (
            SELECT 
            CASE 
                WHEN jsonb_path_exists(feature->'properties', '$.cadastre ? (@.type() == "object")')
                    THEN ARRAY(SELECT jsonb_array_elements_text(feature->'properties'->'cadastre'))
                WHEN jsonb_path_exists(feature->'properties', '$.cadastre ? (@.type() == "string")')
                    THEN ARRAY(SELECT feature->'properties'->>'cadastre')
                END
        )
    FROM cartobio_operators, jsonb_array_elements(cartobio_operators.parcelles->'features') as feature
    WHERE jsonb_path_exists(cartobio_operators.parcelles, '$.features ? (@.type() == "object")')
      AND ST_GeomFromGeoJSON(feature->'geometry') IS NOT NULL
    `
  )

  db.runSql('DROP TRIGGER update_communes ON cartobio_operators')
  db.runSql('DROP FUNCTION update_communes()')

  db.runSql('DROP TRIGGER has_geometry ON cartobio_operators')
  db.runSql('DROP FUNCTION has_geometry()')

  db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION update_communes() RETURNS trigger AS $$
    BEGIN
        NEW.commune = (SELECT CASE
          WHEN NEW.commune IS NULL AND ST_IsValid(NEW.geometry)
          THEN (
              SELECT code
              FROM communes
              WHERE ST_Intersects(
                  NEW.geometry,
                  communes.geometry
              ) LIMIT 1
          )::text
          ELSE NULL
          END
        );
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
  db.runSql(
    /* sql */`
    CREATE TRIGGER update_communes
    BEFORE INSERT OR UPDATE ON cartobio_parcelles
    FOR EACH ROW EXECUTE PROCEDURE update_communes();
  `)
}

exports.down = async function (db) {
  db.dropTable('cartobio_parcelles')
  db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION update_communes() RETURNS trigger AS $$
    BEGIN
        NEW.parcelles = jsonb_set(
            NEW.parcelles,
            '{features}',
            (
                SELECT
                    coalesce(jsonb_agg(
                        (
                            SELECT CASE
                                WHEN feature.value->'properties'->>'COMMUNE' IS NULL
                                    AND ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(feature.value->>'geometry'), 4326))
                                THEN
                                    jsonb_set(
                                        feature.value,
                                        '{properties}',
                                        feature.value->'properties' || jsonb_build_object(
                                            'COMMUNE',
                                            (
                                                SELECT code
                                                FROM communes
                                                WHERE ST_Intersects(
                                                    ST_SetSRID(ST_GeomFromGeoJSON(feature.value->>'geometry'), 4326),
                                                    geometry
                                                ) LIMIT 1
                                            )::text
                                        ),
                                        true
                                    )
                                ELSE
                                    feature.value
                                END
                        )
                    ), '[]'::jsonb)
                FROM jsonb_array_elements(NEW.parcelles->'features') AS feature
            )
        );
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
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

  db.runSql(/* sql */`
    CREATE TRIGGER update_communes
    BEFORE UPDATE OF parcelles OR INSERT ON cartobio_operators
    FOR EACH ROW
    EXECUTE FUNCTION update_communes()
  `)
}

exports._meta = {
  version: 1
}
