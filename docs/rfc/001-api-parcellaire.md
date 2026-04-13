---
title: API d'envoi des parcellaires
date: 2023-04-12
updated_at: 2026-04-10
contributors:
- Laetita L (Ecocert)
- Maud R (CartoBio)
- Thomas P (CartoBio)
- Hugo B (CartoBio)
---

# Mise en place d'une API Parcellaire

Les Organismes de Certification (OC) transmettent des informations de Productions à l'Agence Bio via API. CartoBio propose d'étendre cette démarche au Parcellaire, avec ou sans information géographique associée.

La mise en place de cette API constitue une première étape pour échanger automatiquement des informations entre système d'information, d'abord dans le sens "OC vers CartoBio".

## Proposition

### Prototypage : envoi par fichier

Pour prototyper un import à grande échelle, nous convenons :

- de la production d'un fichier d'export, au format JSON, compressé en ZIP
- transmis de manière sécurisée
- importé manuellement par l'équipe CartoBio

Cette période permettra d'ajuster le format de fichier sous forme de dialogues entre Organisme de Certification et CartoBio.

### Envoi via API

Dans un second temps, lorsque le format d'import sera stabilisé, les parcellaires seront télétransmis à un rythme hebdomadaire voire journalier, sauf dérogation auprès de l'INAO.

```bash
curl --data-binary '@/chemin/vers/parcellaire.json' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: ...' \
  https://cartobio.agencebio.org/api/v2/certification/parcelles
```

### MAJ Mars 2026

Afin de répondre à la problématique des traitements longs et coûteux en ressources, nous avons mis en place une architecture adaptée autour de deux mécanismes complémentaires :  

1. **Polling pattern pour le suivi des traitements asynchrones**
   - Lorsqu’un utilisateur envoie une requête, celle-ci n’est plus traitée immédiatement en mode synchrone.  
   - À la place, un **job asynchrone** est créé et un identifiant unique est renvoyé au client.  
   - L'utilisateur peut ensuite interroger régulièrement l’endpoint `/api/v3/import/jobs/{id}` pour récupérer l’état du traitement (`pending`, `error`, `done`, `created`) et accéder aux résultats dès qu’ils sont disponibles.
   - Ce mécanisme évite les **timeouts**, améliore la **robustesse du système** et permet de mieux **gérer la charge serveur**.  

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
| --------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `202`     | `Accepted`              | Les données d'entrée sont validées et le processus d'import va se lancer.                                                 |
| `207`     | `Multi-Status`          | Les données d'entrée sont partiellement validées et le processus d'import va se lancer sur les données valides.           |
| `400`     | `Bad Request`           | Le fichier JSON est invalide ou certaines données sont incorrectes et donc le traitement ne se lancera pas.               |
| `401`     | `Unauthorized`          | Le jeton d'`Authorization` est manquant.                                                                                  |
| `403`     | `Forbidden`             | Ce jeton d'`Authorization` n'est pas attribué, ou a expiré.                                                               |
| `405`     | `Method Not Allowed`    | L'appel utilise un autre verbe HTTP que `POST`.                                                                           |
| `500`     | `Internal Server Error` | Une erreur inattendue s'est produite de notre côté — un bug doit être résolu pour qu'une nouvelle requête puisse aboutir. |

#### Réponse

En cas de statut `202`, un objet représente le nombre d'objets traités.

| Chemin                  | Type    | Description                                  |
| ----------------------- | ------- | -------------------------------------------- |
| `jobId`                 | integer | id du job d'import                           |
| `nbObjetRecus`          | integer | nombre d'objets reçus                        |
| `nbObjetAcceptes`       | integer | nombre d'objets acceptés                     |
| `nbObjetRefuses`        | integer | nombre d'objets refusés                      |
| `listeNumeroBioValides` | array   | liste des numéros bios qui vont être traités |

```json
{
  "jobId": 26,
  "nbObjetRecus": 1,
  "nbObjetAcceptes": 1,
  "nbObjetRefuses": 0,
  "listeNumeroBioValides": [
    "181932"
  ]
}
```

En cas de statut `207`, un objet représente les objets acceptés et refusés. Seulement les donnéees valides seront traitées.

| Chemin                  | Type    | Description                                         |
| ----------------------- | ------- | --------------------------------------------------- |
| `jobId`                 | integer | id du job d'import                                  |
| `nbObjetRecus`          | integer | nombre d'objets reçus                               |
| `nbObjetAcceptes`       | integer | nombre d'objets acceptes                            |
| `nbObjetRefuses`        | integer | nombre d'objets refuses                             |
| `listeNumeroBioValides` | array   | liste des numéros bios qui vont etre traités        |
| `listeProblemes`        | array   | liste des numéros bios qui ne vont pas etre traités |

```json
{
  "jobId": 26,
  "nbObjetRecus": 3,
  "nbObjetAcceptes": 2,
  "nbObjetRefuses": 1,
  "listeNumeroBioValides": [
    "181932",
    "181933"
  ],
  "listeProblemes": [
    {
      "numeroBio": "181934",
      "message": "Le couple numéro bio - numéro client ne correspond pas aux données du portail de notification"
    }
  ]
}
```

En cas de statut `400`, un objet représente les objets acceptés et refusés. Aucune donnée n'est enregistrée.

| Chemin                  | Type    | Description                                         |
| ----------------------- | ------- | --------------------------------------------------- |
| `nbObjetRecus`          | integer | nombre d'objets reçus                               |
| `nbObjetAcceptes`       | integer | nombre d'objets acceptes                            |
| `nbObjetRefuses`        | integer | nombre d'objets refuses                             |
| `listeNumeroBioValides` | array   | liste des numéros bios qui vont etre traités        |
| `listeProblemes`        | array   | liste des numéros bios qui ne vont pas etre traités |

```json
{
  "nbObjetRecus": 1,
  "nbObjetAcceptes": 0,
  "nbObjetRefuses": 1,
  "listeProblemes": [
    {
      "numeroBio": "181934",
      "message": "Le couple numéro bio - numéro client ne correspond pas aux données du portail de notification"
    }
  ]
}
```

Si le JSON est invalide, le message d'erreur est simplement le suivant :

```json
{
  "error": "Le JSON est invalide"
}
```

#### Différents cas d'erreur

##### Première vérification

| Cas de refus                               | Chemin         | Message d’erreur                                                                                                                          |
| ------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Numéro bio manquant                        | listeProblemes | "message" : "[Index] Numéro bio manquant"                                                                                                 |
| Numéro bio inconnu                         | listeProblemes | "message" : "[Index] Numéro bio inconnu du portail de notification"                                                                       |
| Numéro client manquant                     | listeProblemes | "numeroBio" : "Numéro bio"<br>"message" : "Numéro client manquant"                                                                        |
| Numéro client ne correspond pas au portail | listeProblemes | "numeroBio" : "Numéro bio"<br>"message" : "Le couple numéro bio - numéro client ne correspond pas aux données du portail de notification" |
| Json mal formaté                           | error          | "error" : "Le JSON est invalide"                                                                                                          |

##### Deuxième vérification

| Cas                                           | Type    | Message                                                                           |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| Géométrie corrigée                            | Warning | "geometriesCorrigees" : "liste des id des parcelles corrigées"                    |
| Géométrie invalide acceptée mais non corrigée | Warning | "geometriesInvalidesAcceptees" : "liste des id des parcelles invalides acceptées" |
| Géométrie invalide non corrigeable            | erreur  | "geometriesRejetees" : "id des parcelles rejetées"                                |
| Géométrie absente                             | erreur  | "Parcelle [id] n’a pas de géométrie"                                              |
| Géométrie mal formatée                        | erreur  | "champ géom incorrect" + message d’erreur plus précis                             |
| codeCPF inconnu                               | erreur  | "culture inconnue" : "liste des codes inconnus"                                   |
| codeCPF absent                                | erreur  | "culture absente"                                                                 |

### Suivi des jobs d'import (polling)

#### `GET /api/v3/import/jobs/:id`

Retourne l'état courant d'un job d'import.

##### Codes HTTP jobs import

| Code HTTP | Signification                              |
| --------- | ------------------------------------------ |
| `200`     | Job trouvé, statut retourné.               |
| `404`     | Aucun job ne correspond à cet identifiant. |

##### Statuts possibles

| Statut    | Description                                    |
| --------- | ---------------------------------------------- |
| `CREATED` | Job créé, pas encore démarré.                  |
| `PENDING` | Job en cours de traitement.                    |
| `DONE`    | Traitement terminé avec succès.                |
| `ERROR`   | Une erreur est survenue pendant le traitement. |

##### Réponse `PENDING` ou `CREATE`

```json
{
  "status": "PENDING",
  "created": "2026-03-17T10:00:00.000Z"
}
```

##### Réponse `DONE`

```json
{
  "status": "DONE",
  "nbObjetsRecus": 1,
  "nbObjetsAcceptes": 1,
  "nbObjetsRefuses": 0,
  "result": {
    "count": 1,
    "errors": [],
    "warning": [],
    "numeroBioError": [],
    "numeroBioValid": [
      {
        "numeroBio": "181932",
        "nbParcelles": 2
      }
    ]
  },
  "ended": "2026-04-13T05:00:53.272Z"
}
```

##### Réponse `ERROR`

```json
{
  "status": "ERROR",
  "error": { "name": "Error", "message": "Le fichier JSON est invalide." },
  "ended": "2026-03-17T10:01:05.000Z"
}
```



---

### Consultation des imports

#### `GET /api/v3/import/parcellaire-imports`

Liste paginée des imports de l'OC authentifié.

##### Paramètres query

| Paramètre | Type   | Description                                                         |
| --------- | ------ | ------------------------------------------------------------------- |
| `status`  | string | Filtre par statut (ex. `DONE,ERROR`). Valeurs séparées par virgule. |
| `from`    | string | Date de début (ISO 8601).                                           |
| `to`      | string | Date de fin (ISO 8601).                                             |
| `payload` | bool   | Inclure le payload brut (`true`/`false`, défaut `false`).           |
| `page`    | number | Numéro de page (défaut `1`)é.                                       |
| `limit`   | number | Taille de page (défaut `20`).                                       |

##### Réponse

```json
{
 "data": [
    {
      "jobId": 4,
      "status": "DONE",
      "createdAt": "2026-04-13T04:57:53.587Z",
      "endedAt": "2026-04-13T04:57:53.824Z",
      "nbObjetsRecus": 1,
      "nbObjetsAcceptes": 0,
      "nbObjetsRefuses": 1,
      "result": {
        "count": 1,
        "errors": [
          [
            "181932",
            "cultures inconnues: 01.13.49.967565"
          ]
        ],
        "warning": [],
        "numeroBioError": [
          "181932"
        ],
        "numeroBioValid": []
      },
      "payload": null
    },
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

---

#### `GET /api/v3/import/parcellaire-imports/:id`

Détail d'un import.

##### Paramètres query

| Paramètre | Type | Description                                               |
| --------- | ---- | --------------------------------------------------------- |
| `payload` | bool | Inclure le payload brut (`true`/`false`, défaut `false`). |

Retourne `404` si l'import n'existe pas.

##### Réponse

```json
{
  "status": "DONE",
  "createdAt": "2026-04-13T04:57:53.587Z",
  "endedAt": "2026-04-13T04:57:53.824Z",
  "nbObjetsRecus": 1,
  "nbObjetsAcceptes": 0,
  "nbObjetsRefuses": 1,
  "result": {
    "count": 1,
    "errors": [
      [
        "181932",
        "cultures inconnues: 01.13.49.967565"
      ]
    ],
    "warning": [],
    "numeroBioError": [
      "181932"
    ],
    "numeroBioValid": []
  },
  "payload": null
}
```

### Structure de fichier

#### Audit

| Chemin                   | Type    | Obligatoire | Description                                              |
| ------------------------ | ------- | ----------- | -------------------------------------------------------- |
| `numeroBio`              | string  | **oui**     | numéro bio de l'opérateur                                |
| `numeroClient`           | string  | **oui**     | numéro client de l'opérateur                             |
| `anneeReferenceControle` | integer | **oui**     | année de référence de l'audit AB                         |
| `anneeAssolement`        | integer | non         | année de l'assolement concerné [^1]                      |
| `dateAudit`              | string  | **oui**     | date d'audit au format [ISO 8601] (`YYYY-MM-DD`)         |
| `dateCertificationDebut` | string  | **oui**     | date de début de validité de certification des parcelles |
| `dateCertificationFin`   | string  | **oui**     | date de fin de validité de certification des parcelles   |
| `numeroPacage`           | string  | non         | numéro pacage de l'opérateur (si applicable)             |
| `commentaire`            | string  | non         | notes d'audit                                            |
| `parcelles`              | array   | **oui**     | liste d'éléments de type [Parcelle](#parcelle)           |

#### Parcelle

| Chemin           | Type   | Obligatoire | Description                                                                                                                                                                                                                        |
| ---------------- | ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string | **oui**     | identifiant unique de parcelle (souvent appelé `PK`, `Primary Key` ou `Clé primaire`)                                                                                                                                              |
| `etatProduction` | enum   | **oui**     | `CONV`,`AB`, `C1`, `C2`, `C3` ou `NB`                                                                                                                                                                                              |
| `dateEngagement` | string | non         | date d'engagement au format [ISO 8601] (`YYYY-MM-DD`), **obligatoire** pour les parcelles en conversion (voir si on peut avoir                                              la date d'import et la date de conversion différencier |
| `numeroIlot`     | string | non         | numéro d'ilot PAC (si applicable)                                                                                                                                                                                                  |
| `numeroParcelle` | string | non         | numéro de parcelle PAC (si applicable)                                                                                                                                                                                             |
| `geom`           | string | non         | coordonnées géographiques. Obligatoire si la parcelle est nouvelle. Équivalent du champ `geometry.coordinates` d'une [_feature_ GeoJSON]                                                                                           |
| `commentaire`    | string | non         | notes d'audit spécifiques à la parcelle                                                                                                                                                                                            |
| `cultures`       | array  | **oui**     | liste d'éléments de type [Culture](#culture)                                                                                                                                                                                       |
| `commune`        | number | non         | Code commune de la parcelles                                                                                                                                                                                                       |
| `nom`            | string | non         | Nom de la parcelle                                                                                                                                                                                                                 |

#### Culture

| Chemin      | Type   | Obligatoire | Description                                       |
| ----------- | ------ | ----------- | ------------------------------------------------- |
| `codeCPF`   | string | **oui**     | code culture (nomenclature CPF Bio)               |
| `variete`   | string | non         | variété de culture (si applicable)                |
| `dateSemis` | string | non         | date de semis au format [ISO 8601] (`YYYY-MM-DD`) |
| `quantite`  | float  | non         | surface de la parcelle                            |
| `unite`     | enum   | non         | `ha` (hectare)                                    |

#### Exemple

Exemple de fichier JSON relatif à un audit de 2 parcelles. Elles comportent respectivement 1 et 2 cultures.

```json
[
  {
   "numeroBio": "110994",
   "numeroClient": "100012",
   "anneeReferenceControle": 2022,
   "anneeAssolement": 2022,
   "dateAudit": "2023-02-23",
   "dateCertificationDebut": "2023-03-01",
   "dateCertificationFin": "2024-12-31",
   "numeroPacage": "084012821",
   "commentaire": "",
   "parcelles": [
     {
       "id": "45742",
       "dateEngagement": "2018-01-01",
       "etatProduction": "AB",
       "numeroIlot": "28",
       "numeroParcelle": "1",
       "commentaire": "à revisiter l'année prochaine\nune autre ligne",
       "geom": "[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]",
       "cultures": [
         {
           "codeCPF": "01.19.10.8",
           "variete": "syrah",
           "quantite": 0.25,
           "unite": "ha"
         }
       ],
       "nom": "test",
    },
    {
       "id": "45743",
       "dateEngagement": "2018-01-01",
       "etatProduction": "C1",
       "numeroIlot": "28",
       "numeroParcelle": "2",
       "cultures": [
         {
           "codeCPF": "01.21.12",
           "variete": "syrah",
           "quantite": 2,
           "unite": "ha"
         },
         {
           "codeCPF": "01.19.10.8",
           "quantite": 0.5,
           "unite": "ha",
           "commentaire": "pâturé par des moutons en été"
         }
       ]
    },
    {
       "id": "45744",
       "etatProduction": "AB",
       "numeroIlot": "28",
       "numeroParcelle": "3",
       "cultures": [
         {
           "codeCPF": "01.11.12",
           "variete": "rieti, mottet blanc",
           "dateSemis": "2023-10-10",
           "quantite": 10,
           "unite": "ha"
         },
         {
           "codeCPF": "01.11.95",
           "dateSemis": "2023-07-01",
           "quantite": 10,
           "unite": "ha"
         }
       ]
    }
   ]
  }
]
```

### Algorithme de mise à jour

#### Principe

L'API Parcellaire permet de mettre à jour les données d'un parcellaire, des parcelles et des cultures.
Un parcellaire est identifié par le couple `numeroBio` et `dateAudit`.
Si des données sont déjà enregistrées pour un parcellaire, les données sont mises à jour
avec les nouvelles valeurs. Pour supprimer une valeur existante pour un champ, il suffit donc d'envoyer une chaîne vide
`''` pour ce champ. Les champs non-requis par l'API peuvent être omis ou envoyés avec une valeur
`null`, ils ne seront pas modifiés.

### Parcelles

Le cas particulier des parcelles est traité de la manière suivante :
* si une parcelle avec le même identifiant est déjà enregistrée pour un opérateur, elle est mise à jour avec les nouvelles valeurs
* si aucune parcelle avec le même identifiant n'est pas déjà enregistrée pour un opérateur, elle est ajoutée
* si une parcelle est déjà enregistrée pour un opérateur mais qu'aucune parcelle avec le même identifiant n'est présente dans les données envoyées, elle est supprimée

## Implémentation technique

[`parseAPIParcellaireStream()` et `parcellaireStreamToDb()` dans `lib/providers/api-parcellaire.js`](../../lib/providers/api-parcellaire.js).

[GeoJSON]: https://geojson.org/
[ISO 8601]: https://www.iso.org/iso-8601-date-and-time-format.html

[^1]: si cette valeur n'est pas renseignée, on considère qu'elle équivaut à `anneeReferenceControle`.
