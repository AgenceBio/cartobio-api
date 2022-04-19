
# Obtention du parcellaire d'une exploitation

1. Obtention du token
1. Liste des exploitations
```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/exploitations'
```
1. Liste des parcelles d'une exploitation
```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/parcelles?idexploitation={exploitationId}&millesime=2022'
```

Puis, pour chaque parcelle :
- les compléments PAC/BIO
```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/complementpac/{parcelleId}'
```
- les contours géographiques (piocher `parcelles[].geom_parcelles.[@identifiant="3164500"]`)
```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/geom/ilot/{ilotId}'
```
