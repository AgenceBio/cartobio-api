# CartoBio-API

> API des données parcellaires bio en France.

Elle a vocation à être intégrée à [CartoBio-Presentation] et aux outils
métiers des organismes de certification du bio en France.

## Fonctionnement

```shell
$ npm start
```

Et en développement :

```shell
$ npm run watch
```

### Routes

| Chemin                       | Description
| ---                          | ---
| `/api/v1/version`            | Affiche la version de l'API.
| `/api/v1/test`               | Teste le jeton d'authentification.
| `/api/v1/parcels`            | Retourne la liste des parcelles associées au jeton d'authentification.

L'authentification est assurée grâce à des [jetons JWT][jwt], issus à la main.


### Variables d'environnement

**Remarque** : l'application sait lire les variables définies dans un fichier `.env`.

| Variable                            | Défault                                   | Description
| ---                                 | ---                                       | ---
| `PORT`                              | `8000`                                    | Port réseau sur lequel exposer l'application
| `HOST`                              | `localhost`                               | Interface réseau sur laquelle exposer l'application
| `MATOMO_TRACKER_URL`                | `https://stats.data.gouv.fr/piwik.php`    | Endpoint du suivi statistiques Matomo
| `MATOMO_SITE_ID`                    | `116`                                     | Identifiant de site, pour le suivi des statistiques
| `SENTRY_DSN`                        | ``                                        | DSN Sentry pour le suivi des erreurs applicatives
| `CARTOBIO_JWT_SECRET`               | ``                                        | Secret JSON Web Token, pour vérifier l'authenticité des tokens
| `ESPACE_COLLABORATIF_BASIC_AUTH`    | ``                                        | Authentification à l'[espace collaboratif IGN][api-ign-collab] (depuis un navigateur: `btoa('username:password')`).
| `NOTIFICATIONS_AB_CARTOBIO_USER`    | ``                                        | Adresse email de connexion à l'espace Notifications de l'Agence Bio
| `NOTIFICATIONS_AB_CARTOBIO_PASSWORD`| ``                                        | Mot de passe associé au compte Agence Bio
| `ESPACE_COLLABORATIF_ENDPOINT`      | `https://espacecollaboratif.ign.fr`       | Point d'accès à l'[API Espace Collaboratif d'IGN][api-ign-collab]
| `NOTIFICATIONS_AB_ENDPOINT`         | `https://back.agencebio.org`              | Point d'accès aux [notifications de l'Agence Bio][api-ab]

## Tests

Les test utilisent [Jest] et [supertest] pour leur organisation,
et pour lancer les appels HTTP.

```shell
$ export ESPACE_COLLABORATIF_BASIC_AUTH=…
$ export NOTIFICATIONS_AB_ENDPOINT=https://preprod-notifications.agencebio.org:444/

$ npm test
```


[CartoBio-Presentation]: https://github.com/entrepreneur-interet-general/CartoBio-Presentation/
[jwt]: https://jwt.io/

[api-ign-collab]: https://espacecollaboratif.ign.fr/api/doc
[api-ab]: https://preprod-notification.agencebio.org/

[Jest]: https://jestjs.io/docs/en/getting-started
[supertest]: https://github.com/visionmedia/supertest#readme
