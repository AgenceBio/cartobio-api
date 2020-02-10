# CartoBio-API

> Proxy server is to avoid cors block from espacecollaboratif.ign.fr
> and Agence Bio notifications.

## Fonctionnement

```shell
npm start
```

### Variables d'environnement

| Variable                          | Défault                             | Description
| ---                               | ---                                 | ---
| `PORT`                            | `8000`                              | Port réseau sur lequel exposer l'application
| `IP`                              | `127.0.0.1`                         | Interface réseau sur laquelle exposer l'application
| `ESPACE_COLLABORATIF_ENDPOINT`    | `https://espacecollaboratif.ign.fr` | Point d'accès à l'[API Espace Collaboratif d'IGN][api-ign-collab]


## Tests

Les test utilisent [Jest] et [supertest] pour leur organisation,
et pour lancer les appels HTTP.

```shell
$ export ESPACE_COLLABORATIF_BASIC_AUTH=…

$ npm test
```

| Variable                          | Défault             | Description
| ---                               | ---                 | ---
| `ESPACE_COLLABORATIF_BASIC_AUTH`  |                     | Authentification à l'[espace collaboratif IGN][api-ign-collab] (depuis un navigateur: `btoa('username:password')`).


[api-ign-collab]: https://espacecollaboratif.ign.fr/api/doc

[Jest]: https://jestjs.io/docs/en/getting-started
[supertest]: https://github.com/visionmedia/supertest#readme
