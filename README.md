# CartoBio-API

> API des données parcellaires bio en France.

Elle a vocation à être intégrée à [`cartobio-front`][cartobio-front] et aux outils
métiers des organismes de certification du bio en France.


**Pré-requis** : `node@18`, `postgres@14`, `postgis@3.3`.

**📚 Table des matières**

- [CartoBio-API](#cartobio-api)
  - [Fonctionnement](#fonctionnement)
    - [Routes](#routes)
    - [Variables d'environnement](#variables-denvironnement)
  - [Tests](#tests)
  - [Développer localement](#développer-localement)
- [Manuel d'utilisation](#manuel-dutilisation)
  - [Générer un token d'API](#générer-un-token-dapi)
  - [Renouveler le secret 256](#renouveler-le-secret-256)
  - [Sauvegarder et restaurer la base de données](#sauvegarder-et-restaurer-la-base-de-données)
  - [Déployer en production](#deployer-en-production)
  - [Générer les fonds de carte](#générer-les-fonds-de-carte)

## Fonctionnement

```shell
$ npm start
```

Et en développement :

```shell
$ npm run watch
```

### Routes

| Verbe   | Chemin                          | Description
| ---     | ---                             | ---
| `GET`   | `/api/v1/version`               | Affiche la version de l'API.
| `POST`  | `/api/v1/test`                  | Teste le jeton d'authentification.
| `POST`  | `/api/v1/login`                 | S'authentifie auprès du portail Notification de l'Agence Bio — et de l'API CartoBio.
| `GET`   | `/api/v1/pacage/:numeroPacage`  | Vérification de l'existence d'un PACAGE
| `PATCH` | `/api/v1/operator/:numeroBio`   | Mise à jour partielle des données opérateur (numéro pacage présent/absent, etc.)
| `GET`   | `/api/v1/summary`               | Liste géolocalisée (précision : département) des clients d'un Organisme de Certification.
| `GET`   | `/api/v1/parcels`               | Liste des parcelles des clients d'un Organisme de Certification.
| `GET`   | `/api/v1/parcels/operator/:id`  | Liste des parcelles d'un opérateur donné.

L'authentification est assurée grâce à des [jetons JWT][jwt], issus à la main.


### Variables d'environnement

L'application lit les variables définies dans un fichier `.env`.

| Variable                            | Défault                                   | Description
| ---                                 | ---                                       | ---
| `PORT`                              | `8000`                                    | Port réseau sur lequel exposer l'application
| `HOST`                              | `localhost`                               | Interface réseau sur laquelle exposer l'application
| `DATABASE_URL`                      | `http://docker:docker@api-db:15432/cartobio`| URL de la base de données PostGIS qui contient les couches géographiques, et les données métiers CartoBio
| `MATOMO_TRACKER_URL`                | `https://stats.data.gouv.fr/piwik.php`    | Endpoint du suivi statistiques Matomo
| `MATOMO_SITE_ID`                    | `116`                                     | Identifiant de site, pour le suivi des statistiques
| `SENTRY_DSN`                        | ``                                        | DSN Sentry pour le suivi des erreurs applicatives
| `CARTOBIO_JWT_SECRET`               | ``                                        | Secret JSON Web Token, pour vérifier l'authenticité des tokens
| `NOTIFICATIONS_AB_CARTOBIO_USER`    | ``                                        | Adresse email de connexion à l'espace Notifications de l'Agence Bio
| `NOTIFICATIONS_AB_CARTOBIO_PASSWORD`| ``                                        | Mot de passe associé au compte Agence Bio
| `NOTIFICATIONS_AB_ENDPOINT`         | `https://back.agencebio.org`              | Point d'accès aux [notifications de l'Agence Bio][api-ab]

## Tests

Les test utilisent [Jest] et [supertest] pour leur organisation,
et pour lancer les appels HTTP.

```bash
$ npm test
```

## Développer localement

```bash
$ docker compose run --name api-db --publish=127.0.0.1:15432:5432 --detach db
$ # ou
$ # docker compose run --rm --name api-db --publish=127.0.0.1:15432:5432 db
$ npm run watch
```

Le démarrage du serveur lance automatiquement les migrations du schéma de base de données.

---

Pour avoir quelques données en base :

```bash
$ ./node_modules/.bin/db-migrate up:fixtures
```

Et pour les retirer :

```bash
$ ./node_modules/.bin/db-migrate down:fixtures
```

💡 [**db-migrate**](https://db-migrate.readthedocs.io/en/latest/) : se réferrer
    à sa documentation pour en savoir plus sur les commandes et les API de migration.

# Manuel d'utilisation


## Générer un token d'API

L'`ocId` s'obtient à partir de la route `portail/organismesCertificateurs` de l'API Notification de l'Agence Bio.

1. Se rendre sur [jwt.io](https://jwt.io/) ;
2. Créer un `payload` qui suit ce schéma :
```json
{
  "ocId": <Number>
}
```
3. Renseigner le "secret" (quelqu'un dans l'équipe l'a), et cocher la case `secret base64 encoded` ;
4. Renseigner ces éléments dans la feuille `Demandes d'accès aux données (fichiers et API)` ;
5. Tester ce token avec la route `api/v1/test` pour s'assurer de la qualité du token à transmettre ;
6. Transmettre le token à l'Organisme Certificateur (via un [lien ](), par exemple).

🙌 Bravo !

## Renouveler le secret 256

**Attention** : changer le secret oblige à émettre de nouveaux tokens pour tous les Organismes de Certification.<br>
Tous les tokens précédemment émis ne seront plus fonctionnels.

```bash
$ npx vpg --length 256 | base64
```

## Sauvegarder et restaurer la base de données

```bash
docker exec -i postgres pg_dump --data-only -U docker -h localhost gis > dump.sql
```

Puis restaurer :

```bash
docker exec -i postgres psql -U docker -h localhost gis < dump.sql
```

## Intégration des données du RPG bio

Ces données sont utilisées pour la fonctionnalité d'import en un clic.
Elles sont basées sur le [dump statique](#générer-les-fonds-de-carte) utilisé pour le fond de carte.

```sh
ogr2ogr -f PostgreSQL \
  PG:'postgresql://docker:docker@localhost:15432/gis' rpg.gpkg \
  -preserve_fid -nln rpg_bio -nlt POLYGON \
  --config PG_USE_COPY YES --config OGR_TRUNCATE YES
```

## Intégration de la table de conversion PAC/CPF

```
in2csv Correspondance_PAC_CPFBIO_ONAB.xlsx --sheet 'PAC->BIO' \
  | csvsql --query 'SELECT CODE_PAC as pac, CODE_CPF_BIO as cpf FROM stdin' \
  | csvsql --db 'postgresql://docker:docker@127.0.0.1:15432/gis' \
     --tables correspondance_pac_cpf --insert --no-create
```

## Déployer en production

```bash
# Staging
docker run -d --name postgres-staging --env-file=.env.cartobio-api-staging -v "$(pwd)/postgres_data_staging/postgresql:/var/lib/postgresql" kartoza/postgis:14-3.3

# Production
docker run -d --name postgres-production -p 127.0.0.1:5432:5432 --env-file=.env.cartobio-api-production -v "$(pwd)/postgres_data_production/postgresql:/var/lib/postgresql" kartoza/postgis:14-3.3
```

## Générer les fonds de carte

**Remarque** : Les fonds de carte étaient auparavant servis avec le logiciel Geoserver.

Les fonds de carte sont servis statiquement, et générés à l'aide de l'outil en ligne de commande [tippecanoe] :

```bash
rm rpg.geojson

for FILE in $(ls *.zip); do ogr2ogr -update -append -t_srs EPSG:3857 -nln rpg rpg.gpkg "/vsizip/${FILE}"; done

ogr2ogr rpg.geojson rpg.gpkg

tippecanoe -Z10 -z14 --extend-zooms-if-still-dropping --no-tile-compression --simplify-only-low-zooms --drop-densest-as-needed --output-to-directory rpg-2021 --projection EPSG:3857 --name "RPG 2021" --layer "rpg2021" --exclude NUM_ILOT --exclude NUM_PARCEL --exclude PACAGE --force rpg.geojson
```

## Exporter pour l'ASP

```
npm run export-asp
```

La base générée se trouve sous le nom de `cartobio-asp-MILLESIME.gpkg`.

[cartobio-front]: https://github.com/agencebio/cartobio-front
[jwt]: https://jwt.io/

[api-ab]: https://preprod-notification.agencebio.org/

[Jest]: https://jestjs.io/docs/en/getting-started
[supertest]: https://github.com/visionmedia/supertest#readme
