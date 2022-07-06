# Obtention du parcellaire d'une exploitation

## Liste des "orders"

```bash
curl -H 'Content-Type: application/json' -H "Ocp-Apim-Subscription-Key: $GEOFOLIA_SUBSCRIPTION_KEY" -H "Authorization: Bearer $GEOFOLIA_TOKEN" --get -d "serviceCode=$SERVICE_CODE" $GEOFOLIA_API_URL_V1/data-orders
```

```json
[{"id":"<dataOrderId>","date":"2022-03-08T14:46:26.4246912","dataTransfertId":"4b7df4af-e25c-4828-9d6d-6a6887b42641","dataFilter":null},
{"id":"<dataOrderId>","date":"2022-03-10T12:44:57.1935677","dataTransfertId":"4b7df4af-e25c-4828-9d6d-6a6887b42641","dataFilter":null}]
```

## Attributs d'un "order"

```bash
curl -H 'Content-Type: application/json' -H "Ocp-Apim-Subscription-Key: $GEOFOLIA_SUBSCRIPTION_KEY" -H "Authorization: Bearer $GEOFOLIA_TOKEN" --get -d "serviceCode=$SERVICE_CODE" -d "dataOrderId=<dataOrderId>" $GEOFOLIA_API_URL_V1/flow-attributes
```

```json
[{"id":"<flowId>","serviceId":"...","dataOrderId":"<dataOrderId>","identificationCodes":["..."],"creationTimeStamp":"2022-03-08T14:46:55.3174209","lastAccessTimeStamp":null,"fileName":"D�mo Organisme FAH (France)_Parcelles et Interventions (ZIP)_20220308154647.zip","fileSize":7431}]
```

## Les contours géographiques et leurs attributs

```bash
curl -H 'Content-Type: application/json' -H "Ocp-Apim-Subscription-Key: $GEOFOLIA_SUBSCRIPTION_KEY" -H "Authorization: Bearer $GEOFOLIA_TOKEN" --get -d "serviceCode=$SERVICE_CODE" $GEOFOLIA_API_URL_V1/flows/<flowId> --output <fileName>
```

On récupère un fichier ZIP, qui correspond à la même chose qu'un export via le menu "Export" du loiciel Géofolia.
