module.exports = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: expect.toBeAFeatureId(),
      geometry: {
        type: 'Polygon',
        coordinates: [[[3.9925631200272296, 43.62435318973268], [3.9919796458231462, 43.62517700255613], [3.9917380121957815, 43.62523697202353], [3.9915308976580692, 43.62520198984145], [3.9901018073477736, 43.62449734441172], [3.990818032220158, 43.623546116906454], [3.9925631200272296, 43.62435318973268]]]
      },
      properties: {
        id: expect.toBeAFeatureId(),
        remoteId: '6efe794c-c486-430d-9f5d-75154404b9a4',
        NOM: 'UnePrairieverte2',
        COMMUNE: '29018',
        NUMERO_I: '29',
        conversion_niveau: '',
        commentaires: '',
        cultures: [
          {
            id: '6efe794c-c486-430d-9f5d-75154404b9a4',
            GF: 'H69',
            surface: 2.05
          }
        ]
      }
    },
    {
      type: 'Feature',
      id: expect.toBeAFeatureId(),
      geometry: {
        type: 'Polygon',
        coordinates: [[[3.9925631200272296, 43.62435318973268], [3.9919796458231462, 43.62517700255613], [3.9917380121957815, 43.62523697202353], [3.9915308976580692, 43.62520198984145], [3.9901018073477736, 43.62449734441172], [3.990818032220158, 43.623546116906454], [3.9925631200272296, 43.62435318973268]]]
      },
      properties: {
        id: expect.toBeAFeatureId(),
        remoteId: '50cda72b-7cb8-4d8f-b0a6-94899f0c6123',
        NOM: 'Complète s',
        COMMUNE: '22187',
        NUMERO_I: '29',
        NUMERO_P: '6',
        conversion_niveau: '',
        commentaires: 'Parcelle principale avec détails et avec culture secondaire\n\nParcelle secondaire avec détails secondaire',
        cultures: [
          {
            id: '50cda72b-7cb8-4d8f-b0a6-94899f0c6123',
            GF: 'ZCS      I06',
            CPF: '01.19.10.5',
            date_semis: '2022-04-01',
            variete: 'Arc-en-ciel'
          },
          {
            id: '60f5193f-1b87-4978-a755-6d4149aa3a3f',
            GF: 'ZCU',
            CPF: '01.19.10.6',
            surface: 1,
            variete: 'Trèfle et triticale hors code CPF'
          }
        ]
      }
    }
  ]
}
