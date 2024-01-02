const { collectFeatureIdsFromPayload, createNewEvent, EventType, CertificationState } = require('./history.js')

const collection = {
  type: 'FeatureCollection',
  features: [
    {
      id: 1234
    },
    {
      id: 5678
    }
  ]
}

describe('collectFeatureIdsFromPayload()', () => {
  test('ignores when payload is not a featureCollection', () => {
    expect(collectFeatureIdsFromPayload()).toBeNull()
    expect(collectFeatureIdsFromPayload(null)).toBeNull()
    expect(collectFeatureIdsFromPayload({})).toBeNull()
  })

  test('collect ids from top level property', () => {
    expect(collectFeatureIdsFromPayload(collection)).toEqual([1234, 5678])
  })
})

describe('createNewEvent()', () => {
  /**
   * @type {AgenceBioUser}
   */
  const user = {
    nom: 'test',
    id: 1,
    mainGroup: { nom: 'Opérateur' },
    organismeCertificateur: {
      id: 1,
      nom: 'Ecocert France'
    }
  }

  const featureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        id: '1234',
        properties: {
          conversion_niveau: 'AB',
          cultures: [{ CPF: '01.13.41.1', id: 'a' }]
        }
      },
      {
        id: '5678',
        properties: {
          conversion_niveau: 'AB',
          cultures: [{ CPF: '01.13.41.1', id: 'b' }]
        }
      }
    ]
  }

  /**
   * @type {DBOperatorRecord}
   */
  const record = {
    record_id: 'aaa-bbb-ccc-dddd',
    certification_state: CertificationState.OPERATOR_DRAFT,
    parcelles: featureCollection,
    audit_history: []
  }

  test('create a user bound event on a meaningful event', () => {
    const expectation = {
      type: EventType.FEATURE_COLLECTION_CREATE,
      state: CertificationState.OPERATOR_DRAFT,
      featureIds: ['1234', '5678'],
      user: {
        ...user,
        nom: 'test'
      }
    }

    expect(createNewEvent(
      EventType.FEATURE_COLLECTION_CREATE,
      { features: featureCollection, state: CertificationState.OPERATOR_DRAFT },
      { user, record: null }
    )).toMatchObject(expectation)

    expect(createNewEvent(
      EventType.FEATURE_COLLECTION_CREATE,
      { features: featureCollection.features, state: CertificationState.OPERATOR_DRAFT },
      { user, record }
    )).toMatchObject(expectation)
  })

  test('it should return an event only if the event is beyond AUDITED', () => {
    const expectation = {
      type: EventType.FEATURE_CREATE,
      state: CertificationState.OPERATOR_DRAFT,
      featureIds: ['1234', '5678'],
      user: {
        ...user,
        nom: 'test'
      }
    }

    expect(createNewEvent(
      EventType.FEATURE_CREATE,
      { features: featureCollection.features, state: CertificationState.OPERATOR_DRAFT },
      { user, record }
    )).toBeNull()

    expect(createNewEvent(
      EventType.FEATURE_CREATE,
      { features: featureCollection.features, state: CertificationState.OPERATOR_DRAFT },
      { user, record: { ...record, certification_state: CertificationState.AUDITED } }
    )).toMatchObject(expectation)
  })

  /* @see https://docs.google.com/document/d/1GrrAD7MEZaV9XWrRzmkdhuRYDSTD6fGyn3K8mtynOqI/edit */
  test('should cover the events described in the spec', () => {
    const expectation = {
      type: null,
      description: 'test',
      user: {
        ...user,
        nom: 'test'
      }
    }

    // Import/création du parcellaire : utilisateur + date ;
    expect(createNewEvent(
      EventType.FEATURE_COLLECTION_CREATE,
      { description: 'test' },
      { user, record }
    )).toMatchObject({ ...expectation, type: EventType.FEATURE_COLLECTION_CREATE })

    // Suppression du parcellaire : utilisateur + date
    expect(createNewEvent(
      EventType.FEATURE_COLLECTION_DELETE,
      { description: 'test' },
      { user, record }
    )).toMatchObject({ ...expectation, type: EventType.FEATURE_COLLECTION_DELETE })

    // Ajout de parcelle : utilisateur + date
    expect(createNewEvent(
      EventType.FEATURE_CREATE,
      { description: 'test' },
      { user, record: { ...record, certification_state: CertificationState.AUDITED } }
    )).toMatchObject({ ...expectation, type: EventType.FEATURE_CREATE })

    // Suppression de parcelle : utilisateur + date
    expect(createNewEvent(
      EventType.FEATURE_DELETE,
      { description: 'test' },
      { user, record }
    )).toBeNull()

    expect(createNewEvent(
      EventType.FEATURE_DELETE,
      { description: 'test' },
      { user, record: { ...record, certification_state: CertificationState.AUDITED } }
    )).toMatchObject({ ...expectation, type: EventType.FEATURE_DELETE })

    // Terminer l’audit : utilisateur + date
    expect(createNewEvent(
      EventType.CERTIFICATION_STATE_CHANGE,
      { description: 'test', features: featureCollection.features, state: CertificationState.OPERATOR_DRAFT },
      { user, record: { ...record, certification_state: CertificationState.AUDITED } }
    )).toMatchObject({ ...expectation, type: EventType.CERTIFICATION_STATE_CHANGE })

    // Envoi du parcellaire pour certification : utilisateur + date
    expect(createNewEvent(
      EventType.CERTIFICATION_STATE_CHANGE,
      { description: 'test', state: CertificationState.AUDITED },
      { user, record }
    )).toMatchObject({ ...expectation, type: EventType.CERTIFICATION_STATE_CHANGE })

    // Changement sur le parcellaire : modification de culture, date d’engagement, statut de conversion : utilisateur + date
    expect(createNewEvent(
      EventType.FEATURE_COLLECTION_UPDATE,
      { description: 'test', features: featureCollection.features },
      { user, record }
    )).toBeNull()

    expect(createNewEvent(
      EventType.FEATURE_COLLECTION_UPDATE,
      { description: 'test', features: featureCollection.features },
      { user, record: { ...record, certification_state: CertificationState.AUDITED } }
    )).toMatchObject({ ...expectation, type: EventType.FEATURE_COLLECTION_UPDATE })

    expect(createNewEvent(
      EventType.FEATURE_UPDATE,
      { description: 'test', features: featureCollection.features },
      { user, record }
    )).toBeNull()

    expect(createNewEvent(
      EventType.FEATURE_UPDATE,
      { description: 'test', features: featureCollection.features },
      { user, record: { ...record, certification_state: CertificationState.AUDITED } }
    )).toMatchObject({ ...expectation, type: EventType.FEATURE_UPDATE })

    // Certification du parcellaire : utilisateur + date
    expect(createNewEvent(
      EventType.CERTIFICATION_STATE_CHANGE,
      { description: 'test', features: featureCollection.features, state: CertificationState.CERTIFIED },
      { user, record: { ...record, certification_state: CertificationState.AUDITED } }
    )).toMatchObject({ ...expectation, type: EventType.CERTIFICATION_STATE_CHANGE })
  })
})
