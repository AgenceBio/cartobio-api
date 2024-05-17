# CartoBio-API

> API des données parcellaires bio en France.

Elle a vocation à être intégrée à [`cartobio-front`][cartobio-front] et aux outils
métiers des organismes de certification du bio en France.


**Pré-requis** : `node@20`, `postgres@15`, `postgis@3.3`.

**📚 Table des matières**

- [CartoBio-API](#cartobio-api)
  - [Fonctionnement](#fonctionnement)
    - [Routes](#routes)
    - [Variables d'environnement](#variables-denvironnement)
  - [Tests](#tests)
  - [Développer localement](#développer-localement)
- [Manuel d'utilisation](#manuel-dutilisation)
  - [Brancher au Webservice des Douanes](#brancher-au-webservice-des-douanes)
  - [Sauvegarder et restaurer la base de données](#sauvegarder-et-restaurer-la-base-de-données-en-production)
  - [Intégration des données du RPG bio](#intégration-des-données-du-rpg-bio)
  - [Générer les fonds de carte](#générer-les-fonds-de-carte)
  - [Exporter pour l'ASP](#exporter-pour-lasp)
    - [La couche au 15 mai (tout)](#la-couche-au-15-mai-tout)
    - [La couche au 12 octobre (C1 uniquement)](#la-couche-au-12-octobre-c1-uniquement)

## Fonctionnement

```shell
$ npm start
```

Et en développement :

```shell
$ npm run watch
```

### Routes

| Verbe   | Chemin                         | Description                                                                               |
|---------|--------------------------------|-------------------------------------------------------------------------------------------|
| `GET`   | `/api/v1/version`              | Affiche la version de l'API.                                                              |
| `POST`  | `/api/v1/test`                 | Teste le jeton d'authentification.                                                        |
| `POST`  | `/api/v1/login`                | S'authentifie auprès du portail Notification de l'Agence Bio — et de l'API CartoBio.      |
| `GET`   | `/api/v1/pacage/:numeroPacage` | Vérification de l'existence d'un PACAGE                                                   |
| `PATCH` | `/api/v1/operator/:numeroBio`  | Mise à jour partielle des données opérateur (numéro pacage présent/absent, etc.)          |
| `GET`   | `/api/v1/summary`              | Liste géolocalisée (précision : département) des clients d'un Organisme de Certification. |
| `GET`   | `/api/v1/parcels`              | Liste des parcelles des clients d'un Organisme de Certification.                          |
| `GET`   | `/api/v1/parcels/operator/:id` | Liste des parcelles d'un opérateur donné.                                                 |

L'authentification est assurée grâce à des [jetons JWT][jwt], issus à la main.


### Variables d'environnement

L'application lit les variables définies dans un fichier `.env`.

| Variable                             | Défault                                      | Description                                                                                               |
|--------------------------------------|----------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `PORT`                               | `8000`                                       | Port réseau sur lequel exposer l'application                                                              |
| `HOST`                               | `localhost`                                  | Interface réseau sur laquelle exposer l'application                                                       |
| `DATABASE_URL`                       | `http://docker:docker@api-db:15432/cartobio` | URL de la base de données PostGIS qui contient les couches géographiques, et les données métiers CartoBio |
| `SENTRY_DSN`                         | ``                                           | DSN Sentry pour le suivi des erreurs applicatives                                                         |
| `CARTOBIO_JWT_SECRET`                | ``                                           | Secret JSON Web Token, pour vérifier l'authenticité des tokens                                            |
| `NOTIFICATIONS_AB_ENDPOINT`          | `https://back.agencebio.org`                 | Point d'accès aux [notifications de l'Agence Bio][api-ab]                                                 |

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

## Brancher au Webservice des Douanes

En local, il est impossible d'accéder au webservice des Douanes en direct. Il convient alors d'utiliser un proxy SOCKS via le serveur CartoBio :

```sh
ssh -A -N -C -D 5000 -J user@ip-serveur-cartobio user@ip-serveur-bdd
```

## Sauvegarder et restaurer la base de données en production

```bash
docker run --rm postgres:15 pg_dump --clean -t cartobio_operators -t cartobio_parcelles --data-only -U postgres -h bdd-cartobio -p 5433 postgres > dump-production-data-only.sql
```

Puis restaurer (en préprod) :

```bash
docker run -i --rm postgres:15 psql -v ON_ERROR_STOP=1 -U postgres -h bdd-cartobio -p 5434 postgres < dump-production-data-only.sql
```

**Remarque** : `bdd-cartobio` est un alias de `162.19.57.177` ; le port `5433` correspond à la base de production, et `5434` à la base de préprod.

## Intégration des données du RPG bio

Ces données sont utilisées pour la fonctionnalité d'import en un clic.
Elles sont basées sur le [dump statique](#générer-les-fonds-de-carte) utilisé pour le fond de carte.

```sh
ogr2ogr -f PostgreSQL \
  PG:'postgresql://postgres@bdd-cartobio:5433/postgres' rpg.gpkg \
  -preserve_fid -nln rpg_bio -nlt POLYGON \
  --config PG_USE_COPY YES --config OGR_TRUNCATE YES
```

## Générer les fonds de carte

**Remarque** : Les fonds de carte étaient auparavant servis avec le logiciel Geoserver.

Les fonds de carte sont servis statiquement, et générés à l'aide de l'outil en ligne de commande [tippecanoe] :

```bash
# Décompresser tous les fichiers ZIP départementaux dans un même dossier,
# de telle sorte à ce que tous les fichiers .dbf .prj .shp .shx soient dans un même dossier.
for f in *.zip; do unzip "$f"; done

# Convertir les données en GeoJSON, puis en MBTiles.
ogr2ogr -t_srs EPSG:3857 -nln rpg rpg.gpkg .
ogr2ogr rpg.geojson rpg.gpkg
tippecanoe -Z10 -z14 --extend-zooms-if-still-dropping --no-tile-compression --simplify-only-low-zooms --drop-densest-as-needed --output-to-directory rpg-202x --projection EPSG:3857 --name "RPG 202x" --layer "rpg202x" --exclude NUM_ILOT --exclude NUM_PARCEL --exclude PACAGE --force rpg.geojson
```

[cartobio-front]: https://github.com/agencebio/cartobio-front
[jwt]: https://jwt.io/

[api-ab]: https://preprod-notification.agencebio.org/

[Jest]: https://jestjs.io/docs/en/getting-started
[supertest]: https://github.com/visionmedia/supertest#readme
