---
title: Export ASP
---

L'export contient les données des parcellaires validés
lors d'audits en Agriculture Biologique.

**Période concernée** : du 15 mai de l'année N-1 ↦ 15 mai de l'année N.

## Propriétés des _features_

| Clé                         | Type                | Exemple
| ---                         | ---                 | ---
| `id`                        | Integer             | `910177`
| `numerobio`                 | String              | `34857`
| `engagement_date`           | Date                | `2022-01-01`
| `conversion_niveau`         | Enum (`C1`, ou `C2`, ou `C3` ou `BIO` ou `CONV`)
| `surface_ha`                | Float               | `5.16100`
| `surface_m2`                | Float               | `51601.0`
| `certification_date_debut`  | DateTime            | `2022-01-01T10:00:00Z`
| `certification_date_fin`    | DateTime            | `2023-06-31T09:59:59Z`
| `declassement`              | Object (voir ci-dessous)
| `geom`                      | Geometry            |

### Sous-propriétés du champ `declassement`

Cette cellule contient les informations du déclassement le plus récent.

| Clé                 | Type                            | Exemple
| ---                 | ---                             | ---
| `date`              | Date (`YYYY-MM-DD`)             | `2022-01-01`
| `codeManquement`    | Enum (défini par l'Agence Bio)  | `22`
| `codeMesure`        | Enum (défini par l'Agence Bio)  | `DAC`
| `raison`            | Texte                           | `Utilisation de semence non-bio`
