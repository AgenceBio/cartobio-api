# CartoBio - API

> API des données parcellaires bio en France.

Elle est utilisée par [`cartobio-front`](https://github.com/agencebio/cartobio-front) et aux outils
métiers des organismes de certification du bio en France.

Cette API est réalisée en node avec [Fastify](https://fastify.dev/) et [swagger-ui](https://swagger.io/tools/swagger-ui/) entre autres et la base de données maintenue avec [db-migrate-pg](https://github.com/db-migrate/pg). Les données sont stockées dans une base [PostgreSQL](https://www.postgresql.org/) avec la cartouche spatiale [PostGIS](https://postgis.net/).

Les erreurs sont centralisées avec [Sentry](https://github.com/getsentry/sentry).

## Développement

### Outils nécessaires

-   `docker` avec `compose 2`
-   `node` 20

On pourra utiliser `nvm` pour faciliter la gestion de différentes versions de node (cf. [`.nvmrc`](.nvmrc)) :

```sh
nvm install && nvm use
```

### Configuration

Créer un fichier `.env` inspiré de `.example.env`.

### Dépendances

Démarrer le serveur de données :

```sh
docker compose up db --force-recreate
```

### Application

Récupérer les dépendances :

```sh
# Versions verrouillées
npm ci

# Et/ou en les mettant à jour
npm install
```

Démarrer :

```sh
npm start

# Ou en rechargeant automatiquement
npm run watch
```

Ouvrir :

-   http://localhost:8000/api/version
-   http://localhost:8000/api/v2/test
-   http://localhost:8000/api/documentation/static/index.html

💡 Le démarrage du serveur lance automatiquement les migrations du schéma de base de données avec [**db-migrate**](https://db-migrate.readthedocs.io/en/latest/). Se réferrer à sa documentation pour en savoir plus sur les commandes et les API de migration.

### Données de tests dans la base

```sh
# Ajouter
./node_modules/.bin/db-migrate up:fixtures

# Retirer
./node_modules/.bin/db-migrate down:fixtures
```

### Exécution des tests

Les test utilisent [Jest](https://jestjs.io/docs/en/getting-started) et [supertest](https://github.com/visionmedia/supertest#readme) pour leur organisation et pour lancer les appels HTTP.

```sh
npm test
```

## Déploiement

### Environnement de test

### Environnement de préproduction et production

Le workflow [Docker Image CI](https://github.com/AgenceBio/cartobio-api/blob/main/.github/workflows/docker.yml) dispose de trois jobs :

-   `build`
    -   construit les images docker [agencebio/cartobio-api](https://hub.docker.com/r/agencebio/cartobio-api/tags)
-   `deploy-staging`
    -   déclenché par un nouveau commit dans la branche `main`
    -   déploie l'API de préproduction
-   `deploy-production`
    -   déclenché par un nouvrau tag
    -   déploie l'API de production

Pour créer un tag :

```sh
# Lors d'ajout de fonctionnalités
npm version minor

# Lors d'un correctif ou ajout très mineur
npm version patch
```

Puis :

```sh
git push --version
```

---

<details>
<summary><b>Autres informations</b></summary>

# TODO : reprendre

## Fonctionnement

### Routes

| Verbe   | Chemin                         | Description                                                                               |
| ------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/version`              | Affiche la version de l'API.                                                              |
| `POST`  | `/api/v1/test`                 | Teste le jeton d'authentification.                                                        |
| `POST`  | `/api/v1/login`                | S'authentifie auprès du portail Notification de l'Agence Bio — et de l'API CartoBio.      |
| `GET`   | `/api/v1/pacage/:numeroPacage` | Vérification de l'existence d'un PACAGE                                                   |
| `PATCH` | `/api/v1/operator/:numeroBio`  | Mise à jour partielle des données opérateur (numéro pacage présent/absent, etc.)          |
| `GET`   | `/api/v1/summary`              | Liste géolocalisée (précision : département) des clients d'un Organisme de Certification. |
| `GET`   | `/api/v1/parcels`              | Liste des parcelles des clients d'un Organisme de Certification.                          |
| `GET`   | `/api/v1/parcels/operator/:id` | Liste des parcelles d'un opérateur donné.                                                 |

L'authentification est assurée grâce à des [jetons JWT](https://jwt.io/), issus à la main.

### Variables d'environnement

L'application lit les variables définies dans un fichier `.env`.

| Variable                    | Défault                                      | Description                                                                                               |
| --------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `8000`                                       | Port réseau sur lequel exposer l'application                                                              |
| `HOST`                      | `localhost`                                  | Interface réseau sur laquelle exposer l'application                                                       |
| `DATABASE_URL`              | `http://docker:docker@api-db:15432/cartobio` | URL de la base de données PostGIS qui contient les couches géographiques, et les données métiers CartoBio |
| `SENTRY_DSN`                | ``                                           | DSN Sentry pour le suivi des erreurs applicatives                                                         |
| `CARTOBIO_JWT_SECRET`       | ``                                           | Secret JSON Web Token, pour vérifier l'authenticité des tokens                                            |
| `NOTIFICATIONS_AB_ENDPOINT` | `https://back.agencebio.org`                 | Point d'accès aux [notifications de l'Agence Bio](https://preprod-notification.agencebio.org/)            |

## Brancher au Webservice des Douanes

En local, il est impossible d'accéder au webservice des Douanes en direct. Il convient alors d'utiliser un proxy SOCKS via le serveur CartoBio :

```sh
ssh -A -N -C -D 5000 -J user@ip-serveur-cartobio user@ip-serveur-bdd
```

## Sauvegarder et restaurer la base de données en production

```sh
docker run --rm postgres:15 pg_dump --clean -t cartobio_operators -t cartobio_parcelles --data-only -U postgres -h bdd-cartobio -p 5433 postgres > dump-production-data-only.sql
```

Puis restaurer (en préprod) :

```sh
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

```sh
# Décompresser tous les fichiers ZIP départementaux dans un même dossier,
# de telle sorte à ce que tous les fichiers .dbf .prj .shp .shx soient dans un même dossier.
for f in *.zip; do unzip "$f"; done

# Convertir les données en GeoJSON, puis en MBTiles.
ogr2ogr -t_srs EPSG:3857 -nln rpg rpg.gpkg .
ogr2ogr rpg.geojson rpg.gpkg
tippecanoe -Z10 -z14 --extend-zooms-if-still-dropping --no-tile-compression --simplify-only-low-zooms --drop-densest-as-needed --output-to-directory rpg-202x --projection EPSG:3857 --name "RPG 202x" --layer "rpg202x" --exclude NUM_ILOT --exclude NUM_PARCEL --exclude PACAGE --force rpg.geojson
```

## Autodétéction des communes

Les communes sont ajoutées automatiquement pour un déclencheur en BDD

Via la fonction :

```sql
update_communes()
```

Déclenchée par :

```sql
BEFORE INSERT OR UPDATE ON cartobio_parcelles
```

</details>
