# CartoBio-API

> Proxy server is to avoid cors block from espacecollaboratif.ign.fr
> and Agence Bio notifications.

## Fonctionnement

```shell
npm run watch
```

### Routes

| Chemin                       | Description
| ---                          | ---
| `/api/v1`                    | API CartoBio v1 (registre parcellaire bio)
| `/espacecollaboratif`        | Redirige vers l'[espace collaboratif IGN][api-ign-collab]
| `/notifications`             | Redirige vers les [notifications de l'Agence Bio][api-ab]


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


[api-ign-collab]: https://espacecollaboratif.ign.fr/api/doc
[api-ab]: https://preprod-notification.agencebio.org/

[Jest]: https://jestjs.io/docs/en/getting-started
[supertest]: https://github.com/visionmedia/supertest#readme
