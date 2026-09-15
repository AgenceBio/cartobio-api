# CartoBio - API

> API des données parcellaires bio en France.

Elle est utilisée par [`cartobio-front`](https://github.com/agencebio/cartobio-front) et aux outils
métiers des organismes de certification du bio en France.

Cette API est réalisée en node avec [Fastify](https://fastify.dev/) et [swagger-ui](https://swagger.io/tools/swagger-ui/) entre autres et la base de données maintenue avec [db-migrate-pg](https://github.com/db-migrate/pg). Les données sont stockées dans une base [PostgreSQL](https://www.postgresql.org/) avec la cartouche spatiale [PostGIS](https://postgis.net/).

Les erreurs sont centralisées avec [Sentry](https://github.com/getsentry/sentry).

- [Doc API parcellaire](docs/rfc/001-api-parcellaire.md)
- [Doc API lecture](docs/rfc/002-api-lecture.md)

## Développement

### Outils nécessaires

- `docker` avec `compose 2`
- `node` 24

On utilisera `nvm` pour faciliter la gestion de différentes versions de node (cf. [`.nvmrc`](.nvmrc)) :

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

- http://localhost:8000/api/version
- http://localhost:8000/api/v2/test
- http://localhost:8000/api/documentation/static/index.html

💡 Le démarrage du serveur lance automatiquement les migrations du schéma de base de données avec [**db-migrate**](https://db-migrate.readthedocs.io/en/latest/). Se réferrer à sa documentation pour en savoir plus sur les commandes et les API de migration.

### Données de tests dans la base

```sh
# Ajouter
./node_modules/.bin/db-migrate up

# Retirer
./node_modules/.bin/db-migrate down
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

- `build`
    - construit les images docker [agencebio/cartobio-api](https://hub.docker.com/r/agencebio/cartobio-api/tags)
- `deploy-staging`
    - déclenché par un nouveau commit dans la branche `main`
    - déploie l'API de préproduction
- `deploy-production`
    - déclenché par un nouvrau tag
    - déploie l'API de production

Pour créer un tag :

```sh
# Lors d'ajout de fonctionnalités
npm version minor

# Lors d'un correctif ou ajout très mineur
npm version patch
```

Puis :

```sh
git push --tags
```

---

<details>
<summary><b>Autres informations</b></summary>

## Fonctionnement

L'authentification est assurée grâce à des [jetons JWT](https://jwt.io/), issus à la main.

### Variables d'environnement

L'application lit les variables définies dans un fichier `.env`.

| Variable                                    | Défaut                                                                | Description                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                      | `8000`                                                                | Port réseau sur lequel exposer l'application.                                                                                       |
| `HOST`                                      | `127.0.0.1`                                                           | Interface réseau sur laquelle exposer l'application.                                                                                |
| `NODE_ENV`                                  | `dev`                                                                 | Environnement d'exécution de l'application (`dev`, `production`, `test`).                                                           |
| `APP_ENVIRONMENT`                           | `development`                                                         | Environnement fonctionnel de l'application (`development`, `staging`, `production`, `test`).                                        |
| `FRONTEND_URL`                              | `https://cartobio.agencebio.org`                                      | URL de l'application frontend.                                                                                                      |
| `DATABASE_URL`                              | `postgresql://docker:docker@localhost:15432/gis`                      | URL de connexion à la base de données PostgreSQL/PostGIS.                                                                           |
| `CARTOBIO_JWT_SECRET`                       | ``                                                                    | Secret utilisé pour signer et vérifier les JSON Web Tokens (JWT).                                                                   |
| `DOUANES_BASE_URL`                          | `http://bdd-cartobio/ws`                                              | URL de base du service web des Douanes.                                                                                             |
| `DOUANES_SOCKS_PROXY`                       | ``                                                                    | Proxy SOCKS5 utilisé pour accéder aux services des Douanes.                                                                         |
| `GEOFOLIA_API_HOST`                         | `https://prod-geofolink.azure-api.net`                                | URL de base de l'API Geofolia.                                                                                                      |
| `GEOFOLIA_API_SCOPE`                        | `https://b2cprodgeofolink.onmicrosoft.com/prod-geofolink/.default`    | Scope OAuth utilisé pour obtenir un jeton d'accès à l'API Geofolia.                                                                 |
| `GEOFOLIA_API_SERVICE_CODE`                 | `FR-CARTOBIO-DATA-FIELDS`                                             | Code du service Geofolia utilisé pour les appels API.                                                                               |
| `GEOFOLIA_API_SUBSCRIPTION_KEY`             | ``                                                                    | Clé d'abonnement (API Management) pour accéder à l'API Geofolia.                                                                    |
| `GEOFOLIA_OAUTH_HOST`                       | `https://login.microsoftonline.com/`                                  | Hôte OAuth Microsoft Entra ID (Azure AD).                                                                                           |
| `GEOFOLIA_OAUTH_TENANT`                     | ``                                                                    | Identifiant du tenant Microsoft Entra ID.                                                                                           |
| `GEOFOLIA_OAUTH_CLIENT_ID`                  | ``                                                                    | Identifiant du client OAuth Geofolia.                                                                                               |
| `GEOFOLIA_OAUTH_CLIENT_SECRET`              | ``                                                                    | Secret du client OAuth Geofolia.                                                                                                    |
| `REPORT_ERRORS`                             | `false` (hors production)                                             | Active ou désactive le reporting des erreurs vers Sentry. En production, la valeur dépend également de la présence de `SENTRY_DSN`. |
| `SENTRY_DSN`                                | ``                                                                    | DSN Sentry utilisé pour le suivi des erreurs applicatives.                                                                          |
| `NOTIFICATIONS_AB_ENDPOINT`                 | `https://back.agencebio.org`                                          | Point d'accès au service de notifications de l'Agence Bio.                                                                          |
| `NOTIFICATIONS_AB_ORIGIN`                   | ``                                                                    | Valeur de l'en-tête `Origin` envoyée au service de notifications.                                                                   |
| `NOTIFICATIONS_AB_PUBLIC_KEY`               | ``                                                                    | Clé publique utilisée pour vérifier les notifications de l'Agence Bio.                                                              |
| `NOTIFICATIONS_AB_SERVICE_TOKEN`            | ``                                                                    | Jeton de service utilisé pour authentifier les appels au service de notifications.                                                  |
| `NOTIFICATIONS_AB_SSO_HOST`                 | `https://preprod-oauth.agencebio.org`                                 | URL du serveur SSO de l'Agence Bio.                                                                                                 |
| `NOTIFICATIONS_AB_SSO_CLIENT_ID`            | ``                                                                    | Identifiant du client OAuth pour le SSO de l'Agence Bio.                                                                            |
| `NOTIFICATIONS_AB_SSO_CLIENT_SECRET`        | ``                                                                    | Secret du client OAuth pour le SSO de l'Agence Bio.                                                                                 |
| `NOTIFICATIONS_AB_SSO_AUTHORIZATION_METHOD` | `header`                                                              | Méthode d'envoi des identifiants OAuth (`header` ou `body`).                                                                        |
| `NOTIFICATIONS_AB_SSO_CALLBACK_URI`         | `https://cartobio.agencebio.org/api/auth-provider/agencebio/callback` | URI de redirection après authentification auprès du SSO de l'Agence Bio.                                                            |
| `ATTESTATIONS_PRODUCTIONS_DIRECTORY`        | `.`                                                                   | Répertoire dans lequel sont stockées les attestations de production.                                                                |
| `MAIL_URL`                                  | `smtp://localhost:1025`                                               | URL de connexion au serveur SMTP utilisé pour l'envoi des e-mails.                                                                  |

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

## Intégration des données des départements avec le demaine maritime

Ces données sont utilisées lors du déclencheur (`update_communes`) d'ajout de commune à une parcelle afin de trouver la commune la plus proche pour les parcelles aquacoles et de marquer les parcelles frontalières comme `etranger`.
Elles sont basées sur les géométries des [régions](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/) modifiées via QGIS pour rajouter le domaine maritimes francais.

```sh
ogr2ogr -f PostgreSQL \
  PG:'postgresql://postgres@bdd-cartobio:5433/postgres' territoires.gpkg \
  -preserve_fid -nln territoires -nlt POLYGON \
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

## Cron

Pour lister les cron:

```sh
crontab -l
```

Pour mettre à jour:

```sh
crontab -e
```

Tous les mois les parcellaires marqués comme supprimés (`deleted_at`) depuis plus de 6 mois, sont supprimés dans la base de données.

Le script supprimant les parcellaires est utilisable via `npm run clean-records`

Exemple d'utilisation dans le crontab:

```sh
* 1 * * * (date && docker exec cartobio-api-test npm run clean-records) >> /var/log/cron.log
```

</details>
