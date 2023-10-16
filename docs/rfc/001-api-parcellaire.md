---
title: API Parcellaire
date: 2023-04-12
updated_at: 2023-07-07
contributors:
- Laetita L (Ecocert)
- Maud R (CartoBio)
- Thomas P (CartoBio)
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

### Authentification

L'entête `Authorization` contient le jeton de service fourni par
l'Agence Bio pour s'authentifier sur l'API notifications.
Ce même jeton fonctionne avec l'API CartoBio, en preproduction
et en production.

Ce jeton peut être testé sur l'API notifications sur
le chemin `/api/oc/check-token`.

### Réponses

#### Codes HTTP

```
| Code HTTP | Message HTTP           | Signification
| ---       | ---                    | ---
| `202`     | `Accepted`             | Les données sont acceptées et enregistrées.
| `400`     | `Bad Request`          | Le fichier JSON est invalide ou certaines données sont incorrectes.
| `401`     | `Unauthorized`         | Le jeton d'`Authorization` est manquant.
| `403`     | `Forbidden`            | Ce jeton d'`Authorization` n'est pas attribué, ou a expiré.
| `405`     | `Method Not Allowed`   | L'appel utilise un autre verbe HTTP que `POST`.
| `500`     | `Internal Server Error`| Une erreur inattendue s'est produite de notre côté — un bug doit être résolu pour qu'une nouvelle requête puisse aboutir.
```

#### Réponse

En cas de statut `202`, un objet représente le nombre d'objets traités.

| Chemin           | Type    | Description           |
|------------------|---------|-----------------------|
| `nbObjetTraites` | integer | nombre d'objets reçus |

```json
{
  "nbObjetTraites": 3
}
```

En cas de statut `400`, un objet représente les objets acceptés et refusés. Aucune donnée n'est enregistrée.

| Chemin             | Type    | Description                                          |
|--------------------|---------|------------------------------------------------------|
| `nbObjetTraites`   | integer | nombre d'objets reçus                                |
| `nbObjectAcceptes` | integer | nombre d'objets validés                              |
| `nbObjetRefuses`   | integer | nombre d'objets refusés pour cause d'erreur          |
| `listeProblemes`   | array   | la liste des problèmes et leur index dans le fichier |

```json
{
  "nbObjetTraites": 3,
  "nbObjectAcceptes": 1,
  "nbObjetRefuses": 2,
  "listeProblemes": [
    "[#2] Numéro bio manquant",
    "[#3] Numéro CPF invalide pour la parcelle 2"
  ]
}
```

Si le JSON est invalide, le message d'erreur est simplement le suivant :

```json
{
  "error": "Le JSON est invalide"
}
```

### Structure de fichier

#### Audit

| Chemin                   | Type    | Obligatoire | Description                                      |
|--------------------------|---------|-------------|--------------------------------------------------|
| `numeroBio`              | string  | **oui**     | numéro bio de l'opérateur                        |
| `numeroClient`           | string  | **oui**     | numéro client de l'opérateur                     |
| `anneeReferenceControle` | integer | **oui**     | année de référence de l'audit AB                 |
| `anneeAssolement`        | integer | non         | année de l'assolement concerné [^1]              |
| `dateAudit`              | string  | **oui**     | date d'audit au format [ISO 8601] (`YYYY-MM-DD`) |
| `numeroPacage`           | string  | non         | numéro pacage de l'opérateur (si applicable)     |
| `commentaire`            | string  | non         | notes d'audit                                    |
| `parcelles`              | array   | **oui**     | liste d'éléments de type [Parcelle](#parcelle)   |

#### Parcelle

| Chemin           | Type   | Obligatoire | Description                                                                                                                                                                                                                                |
|------------------|--------|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `id`             | string | **oui**     | identifiant unique de parcelle (souvent appelé `PK`, `Primary Key` ou `Clé primaire`)                                                                                                                                                      |
| `etatProduction` | enum   | **oui**     | `AB`, `C1`, `C2`, `C3` ou `NB`                                                                                                                                                                                                             |
| `dateEngagement` | string | non         | date d'engagement (si connue) au format [ISO 8601] (`YYYY-MM-DD`)=> uniquement pour les parcelles en conversion (voir si on peut avoir                                              la date d'import et la date de conversion différencier |
| `numeroIlot`     | string | non         | numéro d'ilot PAC (si applicable)                                                                                                                                                                                                          |
| `numeroParcelle` | string | non         | numéro de parcelle PAC (si applicable)                                                                                                                                                                                                     |
| `geom`           | string | non         | coordonnées géographiques. Obligatoire si la parcelle est nouvelle. Équivalent du champ `geometry.coordinates` d'une [_feature_ GeoJSON]                                                                                                   |
| `commentaire`    | string | non         | notes d'audit spécifiques à la parcelle                                                                                                                                                                                                    |
| `cultures`       | array  | **oui**     | liste d'éléments de type [Culture](#culture)                                                                                                                                                                                               |

#### Culture

| Chemin      | Type   | Obligatoire | Description                                       |
|-------------|--------|-------------|---------------------------------------------------|
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
       ]
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

### Algorithme de résolution

TBD.


## Implémentation technique

[`parseAPIParcellaireStream()` dans `lib/providers/agence-bio.js`](../../lib/providers/agence-bio.js).

[GeoJSON]: https://geojson.org/
[ISO 8601]: https://www.iso.org/iso-8601-date-and-time-format.html

[^1]: si cette valeur n'est pas renseignée, on considère qu'elle équivaut à `anneeReferenceControle`.
