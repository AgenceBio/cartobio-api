# CartoBio - API

> API des données parcellaires bio en France.

Elle est utilisée par [`cartobio-front`](https://github.com/agencebio/cartobio-front) et aux outils
métiers des organismes de certification du bio en France.

Cette API est réalisée en node avec [Fastify](https://fastify.dev/) et [swagger-ui](https://swagger.io/tools/swagger-ui/) entre autres et l'ORM [Drizzle](https://orm.drizzle.team/) pour l'accès et les migrations de la base de données. Les données sont stockées dans une base [PostgreSQL](https://www.postgresql.org/) avec la cartouche spatiale [PostGIS](https://postgis.net/).

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
docker compose -f docker/docker-compose.yml up db-18 --force-recreate
```

Le service `db` (PostGIS 15) correspond à l'ancienne base. Il n'est utile que pour
[migrer les données](#migration-des-données-depuis-lancienne-base).

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
# En développement (TypeScript exécuté à la volée, rechargement automatique)
npm run dev

# Ou en mode production : compilation dans dist/ puis démarrage
npm run build
npm start
```

Le code est écrit en TypeScript (modules ESM). Les types partagés avec le front
sont dans le workspace [`packages/cartobio-types`](packages/cartobio-types)
(publié sur npm sous le nom `@agencebio/cartobio-types`).

La documentation OpenAPI 3.1 est générée à partir des schémas zod.

Vérifier les types et le lint :

```sh
npm run typecheck
npm run lint
```

Les scripts npm sont regroupés par préfixe :

| Préfixe                       | Usage                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| `build`, `build:*`            | compilation (`dist/`), types partagés, fonds géographiques |
| `start`, `dev`                | démarrage en production / en développement                 |
| `lint`, `format`, `typecheck` | qualité du code                                            |
| `test`, `test:*`              | tests                                                      |
| `db:*`                        | migrations de base de données                              |
| `cron:*`                      | tâches planifiées (crontab des serveurs)                   |
| `job:*`                       | scripts ponctuels                                          |

Ouvrir :

- http://localhost:8000/api/version
- http://localhost:8000/api/v2/test
- http://localhost:8000/api/documentation/static/index.html

### Base de données

Le schéma est décrit avec Drizzle dans [`src/database/schema`](src/database/schema), dans le schéma PostgreSQL `cartobio`.
Les migrations SQL générées sont dans [`database/drizzle`](database/drizzle).

💡 `npm run dev` et `npm start` appliquent automatiquement les migrations et importent les régions, départements et communes.

```sh
# Générer une migration après modification du schéma
npm run db:generate -- nom-de-la-migration

# Appliquer les migrations
npm run db:migrate

# Importer régions, départements et communes (idempotent)
npm run db:seed

# Supprimer les schémas cartobio et drizzle puis rejouer les migrations
npm run db:reset
```

Les écritures en base passent par les validateurs zod de [`src/database/validations`](src/database/validations).

### Migration des données depuis l'ancienne base

Les migrations `db-migrate` de [`database/old_migrations`](database/old_migrations) sont conservées à titre d'historique :
elles servent uniquement à amener une ancienne base à jour avant d'en copier les données.

`SOURCE_DATABASE_URL` désigne l'ancienne base, `TARGET_DATABASE_URL` la nouvelle.

```sh
# 1. Mettre l'ancienne base à jour (si besoin)
DATABASE_URL=$SOURCE_DATABASE_URL npm run db:migrate:legacy

# 2. Créer le schéma de la nouvelle base
npm run db:migrate

# 3. Copier et transformer les données, dans une seule transaction
npm run db:migrate:data
# ou, pour vider la base cible avant la copie
npm run db:migrate:data -- --reset

# 4. Importer régions, départements et communes
npm run db:seed
```

La copie refuse de s'exécuter si la base cible contient déjà des parcellaires (sauf avec `--reset`).

### Exécution des tests

Les test utilisent [Vitest](https://vitest.dev/) et [supertest](https://github.com/visionmedia/supertest#readme) pour leur organisation et pour lancer les appels HTTP.

```sh
npm test

# En continu
npm run test:watch
```

## Déploiement

### Environnement de test

### Environnement de préproduction et production

GitHub Actions lance les tests (`.github/workflows/test.yml`), l'analyse CodeQL et la publication du paquet
`@agencebio/cartobio-types` (`.github/workflows/publish-types.yml`). La construction des images Docker et les
déploiements sont assurés par la CI interne de l'Agence Bio.

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

| Variable                                    | Défaut                                                                | Description                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `PORT`                                      | `8000`                                                                | Port réseau sur lequel exposer l'application.                                                |
| `HOST`                                      | `127.0.0.1`                                                           | Interface réseau sur laquelle exposer l'application.                                         |
| `NODE_ENV`                                  | `dev`                                                                 | Environnement d'exécution de l'application (`dev`, `production`, `test`).                    |
| `APP_ENVIRONMENT`                           | `development`                                                         | Environnement fonctionnel de l'application (`development`, `staging`, `production`, `test`). |
| `FRONTEND_URL`                              | `https://cartobio.agencebio.org`                                      | URL de l'application frontend.                                                               |
| `TARGET_DATABASE_URL`                       | `postgresql://docker:docker@localhost:25432/cartobio`                 | URL de connexion à la base de données PostgreSQL/PostGIS.                                    |
| `SOURCE_DATABASE_URL`                       | ``                                                                    | URL de l'ancienne base, lue uniquement par `npm run db:migrate:data`.                        |
| `CARTOBIO_JWT_SECRET`                       | ``                                                                    | Secret utilisé pour signer et vérifier les JSON Web Tokens (JWT).                            |
| `DOUANES_BASE_URL`                          | `http://bdd-cartobio/ws`                                              | URL de base du service web des Douanes.                                                      |
| `DOUANES_SOCKS_PROXY`                       | ``                                                                    | Proxy SOCKS5 utilisé pour accéder aux services des Douanes.                                  |
| `GEOFOLIA_API_HOST`                         | `https://prod-geofolink.azure-api.net`                                | URL de base de l'API Geofolia.                                                               |
| `GEOFOLIA_API_SCOPE`                        | `https://b2cprodgeofolink.onmicrosoft.com/prod-geofolink/.default`    | Scope OAuth utilisé pour obtenir un jeton d'accès à l'API Geofolia.                          |
| `GEOFOLIA_API_SERVICE_CODE`                 | `FR-CARTOBIO-DATA-FIELDS`                                             | Code du service Geofolia utilisé pour les appels API.                                        |
| `GEOFOLIA_API_SUBSCRIPTION_KEY`             | ``                                                                    | Clé d'abonnement (API Management) pour accéder à l'API Geofolia.                             |
| `GEOFOLIA_OAUTH_HOST`                       | `https://login.microsoftonline.com/`                                  | Hôte OAuth Microsoft Entra ID (Azure AD).                                                    |
| `GEOFOLIA_OAUTH_TENANT`                     | ``                                                                    | Identifiant du tenant Microsoft Entra ID.                                                    |
| `GEOFOLIA_OAUTH_CLIENT_ID`                  | ``                                                                    | Identifiant du client OAuth Geofolia.                                                        |
| `GEOFOLIA_OAUTH_CLIENT_SECRET`              | ``                                                                    | Secret du client OAuth Geofolia.                                                             |
| `NOTIFICATIONS_AB_ENDPOINT`                 | `https://back.agencebio.org`                                          | Point d'accès au service de notifications de l'Agence Bio.                                   |
| `NOTIFICATIONS_AB_ORIGIN`                   | ``                                                                    | Valeur de l'en-tête `Origin` envoyée au service de notifications.                            |
| `NOTIFICATIONS_AB_PUBLIC_KEY`               | ``                                                                    | Clé publique utilisée pour vérifier les notifications de l'Agence Bio.                       |
| `NOTIFICATIONS_AB_SERVICE_TOKEN`            | ``                                                                    | Jeton de service utilisé pour authentifier les appels au service de notifications.           |
| `NOTIFICATIONS_AB_SSO_HOST`                 | _(obligatoire)_                                                       | URL du serveur SSO de l'Agence Bio.                                                          |
| `NOTIFICATIONS_AB_SSO_CLIENT_ID`            | ``                                                                    | Identifiant du client OAuth pour le SSO de l'Agence Bio.                                     |
| `NOTIFICATIONS_AB_SSO_CLIENT_SECRET`        | ``                                                                    | Secret du client OAuth pour le SSO de l'Agence Bio.                                          |
| `NOTIFICATIONS_AB_SSO_AUTHORIZATION_METHOD` | `header`                                                              | Méthode d'envoi des identifiants OAuth (`header` ou `body`).                                 |
| `NOTIFICATIONS_AB_SSO_CALLBACK_URI`         | `https://cartobio.agencebio.org/api/auth-provider/agencebio/callback` | URI de redirection après authentification auprès du SSO de l'Agence Bio.                     |
| `ATTESTATIONS_PRODUCTIONS_DIRECTORY`        | `.`                                                                   | Répertoire dans lequel sont stockées les attestations de production.                         |
| `MAIL_URL`                                  | `smtp://localhost:1025`                                               | URL de connexion au serveur SMTP utilisé pour l'envoi des e-mails.                           |

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

## Intégration des données des départements avec le demaine maritime

Ces données (table `cartobio.territoires`) sont utilisées lors de l'ajout de commune à une parcelle afin de trouver la commune la plus proche pour les parcelles aquacoles et de marquer les parcelles frontalières comme `etranger`.
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

<details>
<summary><b>Fonds de carte RPG (non utilisé)</b></summary>

### Génération des fonds de carte RPG (qui ne sont plus utilisé dans le projet)

```sh
# Décompresser tous les fichiers ZIP départementaux dans un même dossier,
# de telle sorte à ce que tous les fichiers .dbf .prj .shp .shx soient dans un même dossier.
for f in *.zip; do unzip "$f"; done

# Convertir les données en GeoJSON, puis en MBTiles.
ogr2ogr -t_srs EPSG:3857 -nln rpg rpg.gpkg .
ogr2ogr rpg.geojson rpg.gpkg
tippecanoe -Z10 -z14 --extend-zooms-if-still-dropping --no-tile-compression --simplify-only-low-zooms --drop-densest-as-needed --output-to-directory rpg-202x --projection EPSG:3857 --name "RPG 202x" --layer "rpg202x" --exclude NUM_ILOT --exclude NUM_PARCEL --exclude PACAGE --force rpg.geojson
```

</details>

### Génération des fonds de carte Cartobio

Récuperer le fichier "France entière - gpkg - { année }" sur [data.gouv](https://www.data.gouv.fr/datasets/parcelles-certifiees-en-agriculture-biologique-sur-cartobio)

```sh
ogr2ogr -f "gpkg" -s_srs EPSG:4326 -t_srs EPSG:3857 cartobio-parcelles-2025.gpkg cartobio-parcelles-2025-france-4326.gpkg

ogr2ogr cartobio-parcelles-2025.json cartobio-parcelles-2025.gpkg

tippecanoe -Z10 -z14 --extend-zooms-if-still-dropping --no-tile-compression --simplify-only-low-zooms --drop-densest-as-needed --output-to-directory cartobio-parcelles-2025 --projection EPSG:3857 --name "Cartobio parcelles 2025" --layer "catobio-parcelles-2025" --force cartobio-parcelles-2025.json
```

Les fichiers sont ensuite servient via la configuration dans `sites-available`:

```nginx
  location /cartobio-parcelles-2025/ {
    alias /var/www/cartobio-parcelles-2025/;
    add_header Access-Control-Allow-Origin *;
  }
```

## Autodétéction des communes

Quand une parcelle est créée ou que sa géométrie change sans commune renseignée, l'API choisit la commune active
qui recouvre le plus la parcelle (ou la plus proche). Une parcelle hors des territoires est marquée `etranger`
(voir `communeEtEtranger` dans [`parcellaires.utils.ts`](src/shared/parcellaires/parcellaires.utils.ts)).

## Cron

Les tâches `cron:*` tournent dans le conteneur de l'API, lancées par la crontab du serveur (`crontab -l` pour
lister, `crontab -e` pour modifier). Les tâches de purge et `cron:mail-certif` peuvent être relancées sans effet
de bord ; `cron:mail-hebdo` renvoie le rapport à chaque lancement.

| Tâche                | Effet                                                                                                                                    | Fréquence conseillée |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `cron:import`        | Passe en erreur les imports API bloqués depuis plus d'une heure ; vide les charges utiles d'import (7 jours si valide, 3 mois si refusé) | tous les jours, 2 h  |
| `cron:clean-records` | Supprime définitivement les parcellaires supprimés depuis plus de 6 mois et les jetons révoqués expirés (`--dry-run` pour simuler)       | tous les jours, 3 h  |
| `cron:clean-pdf`     | Efface les attestations PDF générées depuis plus de 2 jours (régénérées à la demande)                                                    | tous les jours, 4 h  |
| `cron:mail-certif`   | Prévient les opérateurs dont un parcellaire certifié a été modifié depuis la dernière notification                                       | tous les jours, 7 h  |
| `cron:mail-hebdo`    | Envoie à chaque OC le rapport hebdomadaire de ses envois                                                                                 | le lundi, 8 h        |

Exemple de crontab (adapter le nom du conteneur) :

```sh
0 2 * * *  (date && docker exec cartobio-api npm run cron:import)        >> /var/log/cron.log 2>&1
0 3 * * *  (date && docker exec cartobio-api npm run cron:clean-records) >> /var/log/cron.log 2>&1
0 4 * * *  (date && docker exec cartobio-api npm run cron:clean-pdf)     >> /var/log/cron.log 2>&1
0 7 * * *  (date && docker exec cartobio-api npm run cron:mail-certif)   >> /var/log/cron.log 2>&1
0 8 * * 1  (date && docker exec cartobio-api npm run cron:mail-hebdo)    >> /var/log/cron.log 2>&1
```

Les scripts ponctuels `job:*` écrivent leurs fichiers de sortie (résultats, numéros bio, lignes à corriger) dans
`storage/scripts/`, accessible au seul utilisateur du conteneur. Ces fichiers contiennent des données nominatives :
les supprimer une fois exploités.

</details>
