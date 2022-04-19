
# Obtention du parcellaire d'une exploitation

## Obtention du token

## Liste des exploitations

```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/exploitations'
```

Réponse

```json
{"exploitations":[{"exploitation":{"identification":{"identifiant":20572,"siret":"1876543210008","pacage":"026532467","raisonsociale":"ExpCartoBio","refca":"","cleexploitationuuid":"f0636a71-6a48-41d2-9921-6a561f433ce8"},"contact":{"nom":"Exploitation","prenom":"Cartobio"},"adresse":{"ligne1":"","ligne2":"","codepostal":"","refnormecommune":"26108","nomcommune":"CREST"},"activitedatedebut":1646866800000,"activitedatefin":null,"refsigatypetiers":1,"reftypeinstallation":null,"valorisationsapplication":[{"valorisationapplication":{"code":"MES_PARCELLES"}}],"transaction":{"utilisateuridentifiant":null,"utilisateurnom":null,"utilisateurprenom":null,"verroudate":null,"etat":0}}}]}
```

## Liste des parcelles d'une exploitation
```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/parcelles?idexploitation={exploitationId}&millesime=2022'
```

Réponse

```json
{"parcelles":[{"parcelle":{"identifiant":3164500,"numero":1,"numculture":1,"nom":"parcelle n°1","surfacemesuree":8.73,"surfacesaisie":8.73,"idilot":1960014,"millesime":2022,"idexploitation":20572,"cleparcelleculturaleuuid":"f07f3261-4fc8-4db3-b33c-a9188336de01","geom_empty":false,"has_intervention":false,"has_calcul_n":false,"varietes":[],"cadastres":[],"culture":{"identifiant":36,"libelle":"blé tendre printemps"},"cultureprecedente":{"identifiant":236,"libelle":"seigle hiver"},"transaction":{"modificationDate":1647212400000}}}]}
```

Puis, **pour chaque parcelle** :

### Les compléments PAC/BIO
```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/complementpac/{parcelleId}'
```

Réponse

```json
{"complementpac":{"complementpacidentification":{"idparcelleculturale":3164500,"numculture":1},"codevariete":"001","cultureenbio":null,"cultureconvbio":null,"nbafc":null,"culturebio":false,"codeculturepaceffectif":"BTP"}}
```

### Les contours géographiques

Note: piocher `parcelles[].geom_parcelles.[@identifiant="3164500"]`.

```bash
curl -v -XGET -H 'Content-Type: application/json' -H 'Accept: application/json' -H "Authorization: Bearer $CARTOBIO_MP_TOKEN" 'https://rhone-alpes.mesparcelles.fr/api/geom/ilot/{ilotId}'
```

Réponse

```json
{"geom_ilot":{"identifiant":1960014,"geom":{"type":"Polygon","coordinates":[[[859952.161,6406319.29],[859925.703,6406300.24],[859897.128,6406288.598],[859890.249,6406290.186],[859876.49,6406284.365],[859810.919,6406433.61],[859811.424,6406436.895],[859819.707,6406437.556],[859835.315,6406444.227],[859833.671,6406468.846],[859832.893,6406472.45],[859833.33,6406477.482],[859835.607,6406482.195],[859836.947,6406484.72],[859840.711,6406488.574],[859862.453,6406503.787],[859869.469,6406507.749],[859877.792,6406512.452],[859886.077,6406514.335],[859897.44,6406515.633],[859924.644,6406516.14],[859937.345,6406531.486],[859943.695,6406557.415],[859930.995,6406573.29],[859925.703,6406588.636],[859964.332,6406617.211],[859981.266,6406629.911],[859992.907,6406637.849],[860011.428,6406654.253],[860033.124,6406687.591],[860053.232,6406712.991],[860068.36,6406722.685],[860076.516,6406699.232],[860098.206,6406685.252],[860131.293,6406642.315],[860136.531,6406636.451],[860151.798,6406618.586],[860171.563,6406600.67],[860183.929,6406591.062],[860224.891,6406569.006],[860112.325,6406469.753],[860109.853,6406452.111],[860117.262,6406416.657],[860114.087,6406374.323],[860083.924,6406369.032],[860063.286,6406363.211],[860022.541,6406345.748],[859960.628,6406319.29],[859952.161,6406319.29]]]},"parcelles":[{"geom_parcelle":{"identifiant":3164500,"geom":{"type":"Polygon","coordinates":[[[859952.161,6406319.29],[859925.703,6406300.24],[859897.128,6406288.598],[859890.249,6406290.186],[859876.49,6406284.365],[859810.919,6406433.61],[859811.424,6406436.895],[859819.707,6406437.556],[859835.315,6406444.227],[859833.671,6406468.846],[859832.893,6406472.45],[859833.33,6406477.482],[859835.607,6406482.195],[859836.947,6406484.72],[859840.711,6406488.574],[859862.453,6406503.787],[859869.469,6406507.749],[859877.792,6406512.452],[859886.077,6406514.335],[859897.44,6406515.633],[859924.644,6406516.14],[859937.345,6406531.486],[859943.695,6406557.415],[859930.995,6406573.29],[859925.703,6406588.636],[859964.332,6406617.211],[859981.266,6406629.911],[859992.907,6406637.849],[860011.428,6406654.253],[860033.124,6406687.591],[860053.232,6406712.991],[860068.36,6406722.685],[860076.516,6406699.232],[860098.206,6406685.252],[860131.293,6406642.315],[860136.531,6406636.451],[860151.798,6406618.586],[860171.563,6406600.67],[860183.929,6406591.062],[860224.891,6406569.006],[860112.325,6406469.753],[860109.853,6406452.111],[860117.262,6406416.657],[860114.087,6406374.323],[860083.924,6406369.032],[860063.286,6406363.211],[860022.541,6406345.748],[859960.628,6406319.29],[859952.161,6406319.29]]]}}}]}}
```
