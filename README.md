# CartoBio-API

> Proxy server is to avoid cors block from espacecollaboratif.ign.fr
> and Agence Bio notifications.

## Fonctionnement

```shell
npm start
```

### Routes

| Chemin                       | Description
| ---                          | ---
| `/espacecollaboratif`        | Redirige vers l'[espace collaboratif IGN][api-ign-collab]
| `/notifications`             | Redirige vers les [notifications de l'Agence Bio][api-ab]


### Variables d'environnement

| Variable                          | Défault                                   | Description
| ---                               | ---                                       | ---
| `PORT`                            | `8000`                                    | Port réseau sur lequel exposer l'application
| `IP`                              | `127.0.0.1`                               | Interface réseau sur laquelle exposer l'application
| `ESPACE_COLLABORATIF_ENDPOINT`    | `https://espacecollaboratif.ign.fr`       | Point d'accès à l'[API Espace Collaboratif d'IGN][api-ign-collab]
| `NOTIFICATIONS_AB_ENDPOINT`       | `https://back.agencebio.org` | Point d'accès aux [notifications de l'Agence Bio][api-ab]


## Tests

Les test utilisent [Jest] et [supertest] pour leur organisation,
et pour lancer les appels HTTP.

```shell
$ export ESPACE_COLLABORATIF_BASIC_AUTH=…
$ export NOTIFICATIONS_AB_ENDPOINT=https://preprod-notifications.agencebio.org:444/

$ npm test
```

| Variable                          | Défault             | Description
| ---                               | ---                 | ---
| `ESPACE_COLLABORATIF_BASIC_AUTH`  |                     | Authentification à l'[espace collaboratif IGN][api-ign-collab] (depuis un navigateur: `btoa('username:password')`).


[api-ign-collab]: https://espacecollaboratif.ign.fr/api/doc
[api-ab]: https://preprod-notification.agencebio.org/

[Jest]: https://jestjs.io/docs/en/getting-started
[supertest]: https://github.com/visionmedia/supertest#readme
