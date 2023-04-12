---
title: API Parcellaire
date: 2023-04-12
contributors:
- Thomas P (CartoBio)
- Laetita L (Ecocert)
---

# Mise en place d'une API Parcellaire

Les Organismes de Certification (OC) transmettent des informations de Productions à l'Agence Bio via API. CartoBio propose d'étendre cette démarche au Parcellaire, avec ou sans information géographique associée.

La mise en place de cette API constitue une première étape pour échanger automatiquement des informations entre système d'information, d'abord dans le sens "OC vers CartoBio".

## Proposition

### Prototypage : import/export à intervalle régulier

Pour prototyper un import à grande échelle, nous convenons :

- de la production d'un fichier d'export, au format JSON, compressé en ZIP
- en fin de mois
- transmis de manière sécurisée (via https://drop.infini.fr/ si inférieur à 1Go)
- importé manuellement par l'équipe CartoBio

Cette période permettra d'ajuster le format de fichier sous forme de dialogues entre OC et CartoBio.

### Envoi via API

Dans un second temps, lorsque le format d'import sera stabilisé, les parcellaires seront télétransmis

```bash
curl --data-binary '@/chemin/vers/parcellaire.json' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: ...' \
  https://cartobio.agencebio.org/api/v2/certification/parcelles
```

L'entête `Authorization` contient un jeton de service fourni par l'Agence Bio.\
Ce même jeton fonctionne également avec l'API CartoBio.

#### Codes HTTP

| Code HTTP                   | Signification
| ---                         | ---
| `202 Accepted`              | Les données sont acceptées. Leur traitement se fera en traitement différé de plusieurs minutes.
| `400 Bad Request`           | La requête contient des données qui ne sont pas structurées tel que décrit ci-dessus.
| `401 Unauthorized`          | Le jeton d'`Authorization` est manquant.
| `403 Forbidden`             | Ce jeton d'`Authorization` n'est pas attribué, ou a expiré.
| `405 Method Not Allowed`    | L'appel utilise un autre verbe HTTP que `POST`.
| `500 Internal Server Error` | Une erreur inattendue s'est produite de notre côté — un bug doit être résolu pour qu'une nouvelle requête puisse aboutir.

## Implémentation technique

[`parseAPIParcellaireStream()` dans `lib/providers/agence-bio.js`](../../lib/providers/agence-bio.js).

### Structure de fichier

| Chemin                    | Type        | Description
| ---                       | ---         | ---
| `typeEnvoi`               | enum        | `M` pour modification, `A` pour ajout
| `numeroBio`               | string      | numéro bio de l'opérateur
| `numeroClient`            | string      | numéro client de l'opérateur
| `anneeReferenceControle`  | integer     | année de référence de l'audit AB
| `numeroPacage`            | string      | numéro pacage de l'opérateur (si applicable)
| `commentaire`             | string      | notes d'audit
| `parcelles`               | array       | liste des parcelles
| `parcelles.id`            | string      | identifiant unique de parcelle
| `parcelles.codeCPF`       | string      | code culture (nomenclature CPF Bio)
| `parcelles.etatProduction`| enum        | `AB`, `C1`, `C2`, `C3` ou `C0`
| `parcelles.dateEngagement`| string      | date d'engagement au format [ISO 8601] (`YYYY-MM-DD`)
| `parcelles.dateAudit`     | string      | date d'audit au format [ISO 8601] (`YYYY-MM-DD`)
| `parcelles.quantite`      | float       | surface de la parcelle
| `parcelles.unite`         | enum        | `ha` (hectare) ou `a` (are)
| `parcelles.numeroIlot`    | string      | numéro d'ilot PAC (si applicable)
| `parcelles.numeroParcelle`| string      | numéro de parcelle PAC (si applicable)
| `parcelles.geom`          | string      | équivalent du champ `geometry.coordinates` d'une _feature_ [GeoJSON] (si applicable)
| `parcelles.commentaire`   | string      | notes d'audit spécifiques à la parcelle

**Exemple** :

```json
[
  {
   "typeEnvoi": "M",
   "numeroBio": "110994",
   "numeroClient": "100012",
   "anneeReferenceControle": 2022,
   "numeroPacage": "084012821",
   "commentaire": "",
   "parcelles": [
     {
       "activites": "1",
       "id": "45742",
       "codeCPF": "01.92",
       "dateEngagement": "2018-01-01",
       "dateAudit": "2023-02-23",
       "etatProduction": "AB",
       "quantite": 0.25,
       "unite": "ha",
       "numeroIlot": "28",
       "numeroParcelle": "1",
       "geom": "[[[4.8740990843182042,44.255949709765304],[4.8739614029301244,44.255016135661734],[4.8736532263747678,44.255001848456033],[4.8738004728368587,44.255928756333255],[4.8740990843182042,44.255949709765304]]]",
       "commentaire": ""
    }
   ]
  },
  // …
]
```

### Algorithme de résolution

TBD.

[GeoJSON]: https://geojson.org/
[ISO 8601]: https://www.iso.org/iso-8601-date-and-time-format.html
