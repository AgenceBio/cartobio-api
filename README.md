# CartoBio-API

> API des données parcellaires bio en France.

Elle a vocation à être intégrée à [CartoBio-Presentation] et aux outils
métiers des organismes de certification du bio en France.

**📚 Table des matières**

- [Fonctionnement](#fonctionnement)
- [Variables d'environnement](#variables-denvironnement)
- [**Manuel d'utilisation**](#manuel-dutilisation)
  - [Générer un token d'API](#générer-un-token-dapi)

## Fonctionnement

```shell
$ npm start
```

Et en développement :

```shell
$ npm run watch
```

### Routes

| Chemin                          | Description
| ---                             | ---
| `/api/v1/version`               | Affiche la version de l'API.
| `/api/v1/test`                  | Teste le jeton d'authentification.
| `/api/v1/login`                 | S'authentifie auprès du portail Notification de l'Agence Bio — et de l'API CartoBio.
| `/api/v1/summary`               | Liste géolocalisée (précision : département) des clients d'un Organisme de Certification.
| `/api/v1/parcels`               | Liste des parcelles des clients d'un Organisme de Certification.
| `/api/v1/parcels/operator/:id`  | Liste des parcelles d'un opérateur donné.

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

## Développer localement

```bash
$ docker-compose run --name api-db --publish=127.0.0.1:15432:5432 --detach db
$ npm run watch
```

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


[CartoBio-Presentation]: https://github.com/entrepreneur-interet-general/CartoBio-Presentation/
[jwt]: https://jwt.io/

[api-ign-collab]: https://espacecollaboratif.ign.fr/api/doc
[api-ab]: https://preprod-notification.agencebio.org/

[Jest]: https://jestjs.io/docs/en/getting-started
[supertest]: https://github.com/visionmedia/supertest#readme
