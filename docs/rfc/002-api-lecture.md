---
title: API de lecture des parcellaires
date: 2023-12-05
updated_at: 2023-12-05
contributors:
- Maud R (CartoBio)
- Thomas P (CartoBio)
---

# Mise en place d'une API de lecture des parcellaires

La mise en place de cette API constitue un mécanisme pour récupérer les données géographique d'un parcellaire opérateur, ainsi que de ses dernières informations de certification.

## Proposition

### Accès via API HTTP


```bash
curl -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: ...' \
  https://cartobio.agencebio.org/api/v2/certification/parcellaire/:numeroBio
```

### Authentification

L'entête `Authorization` contient le jeton de service fourni par
l'Agence Bio pour s'authentifier sur l'API notifications.
Ce même jeton fonctionne avec l'API CartoBio, en preproduction
et en production.

Ce jeton peut être testé sur l'API notifications sur
le chemin `/api/oc/check-token`.

### Réponses

#### Codes HTTP

| Code HTTP | Message HTTP            | Signification                                                                                                             |
|-----------|-------------------------|---------------------------------------------------------------------------------------------------------------------------|
| `200`     | `OK`                    | Tout s'est bien passé.                                                                                                    |
| `401`     | `Unauthorized`          | Le jeton d'`Authorization` est manquant.                                                                                  |
| `403`     | `Forbidden`             | Ce jeton d'`Authorization` n'est pas attribué, ou a expiré.                                                               |
| `404`     | `Not Found`             | Aucun parcellaire trouvé pour ce numéro bio.                                                                              |
| `405`     | `Method Not Allowed`    | L'appel utilise un autre verbe HTTP que `GET`.                                                                            |
| `500`     | `Internal Server Error` | Une erreur inattendue s'est produite de notre côté — un bug doit être résolu pour qu'une nouvelle requête puisse aboutir. |

En cas de statut `200`, un objet JSON représentant l'opérateur, son parcellaire et son statut de certification.

#### Propriétés de la réponse

| Clé                           | Type                                     | Description                                                                                          |
|-------------------------------|------------------------------------------|------------------------------------------------------------------------------------------------------|
| `numeroBio`                   | `string`                                 | Numéro bio de l'opérateur                                                                            |
| `certification`               | `object`                                 | -                                                                                                    |
| `certification.statut`        | `string`                                 | Statut du parcellaire ([cf. statuts de certification](#valeurs-possibles--statuts-de-certification)) |
| `certification.dateDebut`     | `string`                                 | Date de début de validité de certification du parcellaire (au format [ISO 8601])                     |
| `certification.dateFin`       | `string`                                 | Date de fin de validité de certification du parcellaire (au format [ISO 8601])                       |
| `certification.demandesAudit` | `string`                                 | Mémo à l'intention de l'exploitant                                                                   |
| `certification.notesAudit`    | `string`                                 | Notes final de l'audit                                                                               |
| `parcellaire`                 | [`FeatureCollection`][FeatureCollection] | Le parcellaire géographique (voir [ci-après](#format-du-parcellaire))                                |

#### Format du parcellaire

Le parcellaire est représenté en utilisant le [format standardisé **GeoJSON**][GeoJSON], par un objet de type [`FeatureCollection`][FeatureCollection].
- chaque parcelle est un objet de type [`Feature`][Feature]
- la clé standard `geometry` est forcément de type [`Polygon`][Polygon]
- la clé standard `properties` est utilisée sur chaque `Feature` pour enregistrer les données de chaque parcelles

##### Propriétés obligatoires

| Clé                | Type     | Description                                                                                                             |
|--------------------|----------|-------------------------------------------------------------------------------------------------------------------------|
| `id`               | `string` | Le numéro bio de l'opérateur                                                                                            |
| `commune`          | `string` | Code INSEE de la commune                                                                                                |
| `cultures`         | `array`  | Liste des cultures en place ([cf. Cultures](#cultures))                                                                 |
| `niveauConversion` | `string` | Niveau de conversion en Agriculture Biologique ([cf. niveaux de conversion](#valeurs-possibles--niveaux-de-conversion)) |
| `dateEngagement`   | `string` | Date d'engagement en Agriculture Biologique de la parcelle (si applicable) (au format [ISO 8601])                       |
| `commentaire`      | `string` | Notes d'audit spécifiques à la parcelle                                                                                 |
| `annotations`      | `array`  | Liste d'étiquettes ([cf. Annotations](#valeurs-possibles--annotations))                                                 |


##### Propriétés facultatives

| Clé                   | Type     | Description                                                                                       |
|-----------------------|----------|---------------------------------------------------------------------------------------------------|
| `dateAjout`           | `string` | Date d'ajout sur CartoBio (au format [ISO 8601])                                                  |
| `dateMiseAJour`       | `string` | Date de modification sur CartoBio (au format [ISO 8601])                                          |
| `nom`                 | `string` | Nom de la parcelle                                                                                |
| `numeroPacage`        | `string` | Numéro PACAGE                                                                                     |
| `numeroIlotPAC`       | `string` | Numéro de l'ilôt PAC                                                                              |
| `numeroParcellesPAC`  | `string` | Numéro de la parcelle PAC                                                                         |
| `referenceCadastrale` | `string` | Référence cadastrale complète (code INSEE de la commune + préfixe + section + numéro de parcelle) |

##### Cultures

| Clé         | Type     | Description                                                                               |
|-------------|----------|-------------------------------------------------------------------------------------------|
| `cpf`       | `string` | Code CPF de la culture[^cpf]                                                              |
| `surface`   | `float`  | (facultatif) Surface de la culture. Utile en cas de multi-cultures sur une même parcelle. |
| `unite`     | `enum`   | (facultatif) Unité exprimée de la surface. Par défaut, en _hectare_.                      |
| `variete`   | `string` | (facultatif) Variété de la culture                                                        |
| `dateSemis` | `string` | (facultatif) Date de semis (au format [ISO 8601])                                         |

#### Valeurs possibles : statuts de certification

| Valeur                  | Description                         |
|-------------------------|-------------------------------------|
| `OPERATOR_DRAFT`        | Brouillon                           |
| `AUDITED`               | Audité                              |
| `PENDING_CERTIFICATION` | Audité, transmis pour certification |
| `CERTIFIED`             | Certifié                            |

#### Valeurs possibles : niveaux de conversion

| Valeur | Description                                                                                                              |
|--------|--------------------------------------------------------------------------------------------------------------------------|
| `C0`   | Conventionnel                                                                                                            |
| `C1`   | Conversion 1<sup>ère</sup> année                                                                                         |
| `C2`   | Conversion 2<sup>ème</sup> année                                                                                         |
| `C3`   | Conversion 3<sup>ème</sup> année                                                                                         |
| `AB`   | Agriculture Biologique                                                                                                   |
| `AB?`  | Engagée en AB, mais niveau indéterminé (C1, C2, C3 ou AB) tant qu'il n'est pas précisé par l'organisme de certification. |

#### Valeurs possibles : unités

| Valeur | Description          |
|--------|----------------------|
| `ha`   | Hectare (par défaut) |
| `%`    | Pourcentage          |

#### Valeurs possibles : annotations

| Valeur                 | Description             |
|------------------------|-------------------------|
| `reduction-conversion` | Réduction de conversion |
| `downgraded`           | Déclassement            |
| `risky`                | À risque                |
| `sampled`              | Prélèvement effectué    |
| `surveyed`             | Visitée                 |

#### Exemple

Exemple de fichier JSON relatif à un audit de 1 parcelles avec 1 culture permanente, et 2 cultures prévues.

```json
{
  "numeroBio": "9999",
  "certification": {
    "statut": "CERTIFIED",
    "dateDebut": "2023-05-14",
    "dateFin": "2024-11-14",
    "demandesAudit": "Memo à l'intention de l'exploitant",
    "notesAudit": "Notes final d'audit"
  },
  "parcellaire": {
    "type": "FeatureCollection",
    "features": [
      {
        "id": 45742,
        "geometry": {
          "type": "Polygon",
          "coordinates": […]
        },
        "properties": {
          "id": 45742,
          "annotations": ["sampled", "surveyed"],
          "commentaire": "Visitée, Prélèvement effectué",
          "commune": "97411",
          "dateAjout": "2022-03-13:37:42Z",
          "dateEngagement": "2022-12-31",
          "dateMiseAJour": "2023-01-01T12:34:56Z",
          "cultures": [
            {
              "cpf": "01.21.12",
              "surface": 1.00,
              "unite": "ha",
              "variete": "Chardonnay"
            },
            {
              "cpf": "01.19.10.7",
              "surface": 0.30,
              "unite": "ha",
              "variete": "trèfle incarnat",
              "dateSemis": "2023-03-15"
            },
            {
              "cpf": "01.19.10.7",
              "variete": "trèfle lotier",
              "dateSemis": "2023-03-15"
            }
          ],
          "niveauConversion": "AB",
          "nom": "Haut de la colline",
          "numeroPacage": "999100540",
          "numeroIlotPAC": "1",
          "numeroParcellesPAC": "3",
          "referenceCadastrale": "97411000BP0885"
        }
      }
    ]
  }
}
```

[^cpf]: Selon l'extension de la nomenclature CPF gérée par l'Agence Bio. Elle garantit que opérateurs _et_ organismes de certification décrivent l'assolement d'une manière commune.

[GeoJSON]: https://geojson.org/
[ISO 8601]: https://www.iso.org/iso-8601-date-and-time-format.html
[FeatureCollection]: https://datatracker.ietf.org/doc/html/rfc7946#section-3.3
[Feature]: https://datatracker.ietf.org/doc/html/rfc7946#section-3.2
[Polygon]: https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6
