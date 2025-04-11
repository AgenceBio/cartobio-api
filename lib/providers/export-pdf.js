const fs = require('fs')
const { formatDate, getOptimalZoom, formatRefCad, calculateGlobalBoundingBox, launchStyleTab, drawParcelleHighlightOnMap, drawAllParcellesOnMap, mergeAndAddFooter, getAllParcelles, imageToBase64 } = require('./utils-pdf')
const path = require('path')
const puppeteer = require('puppeteer')
const { fromCodeCpf } = require('@agencebio/rosetta-cultures')
const { fetchOperatorByNumeroBio } = require('./agence-bio.js')
const { setTimeout } = require('node:timers/promises')

const pool = require('../db.js')

/**
 * Génère une image de carte pour un opérateur et ses parcelles
 * @param {any[]} parcelles - L'ID de l'enregistrement de l'opérateur
 * @param {Object} options - Options pour la génération des images
 * @returns {Promise<Object>} - Objet contenant les buffers des images générées
 */
async function generateOperatorMapImages (parcelles, page, options = {}) {
  try {
    const globalBbox = calculateGlobalBoundingBox(parcelles)

    // Paramètres par défaut
    const viewportWidth = options.width || 465
    const viewportHeight = options.height || 389
    const timeout = options.timeout || 30000

    const globalZoom = getOptimalZoom(
      globalBbox.width,
      globalBbox.height,
      viewportWidth,
      viewportHeight
    )

    const globalResult = await drawAllParcellesOnMap(page, parcelles, {
      width: viewportWidth,
      height: viewportHeight,
      center: [globalBbox.centerx, globalBbox.centery],
      zoom: globalZoom,
      timeout
    })

    if (globalResult.error) {
      console.error(`Erreur lors de la génération de l'image globale: ${globalResult.error}`)
      return { global: null, parcelles: [] }
    }

    const parcelleImages = []

    for (const parcelle of parcelles) {
      const parcelleZoom = getOptimalZoom(
        parcelle.maxx - parcelle.minx,
        parcelle.maxy - parcelle.miny,
        viewportWidth,
        viewportHeight
      )

      const parcelleResult = await drawParcelleHighlightOnMap(page, parcelles, parcelle, {
        width: viewportWidth,
        height: viewportHeight,
        center: [parcelle.centerx, parcelle.centery],
        zoom: parcelleZoom,
        timeout
      })

      if (parcelleResult.error) {
        console.error(`Erreur lors de la génération de l'image pour la parcelle ${parcelle.id}: ${parcelleResult.error}`)
        continue
      }

      parcelleImages.push({
        id: parcelle.id,
        buffer: parcelleResult.buffer
      })
    }
    return {
      global: {
        buffer: globalResult.buffer
      },
      parcelles: parcelleImages
    }
  } catch (error) {
    console.error('Erreur dans generateOperatorMapImages:', error)
    return { global: null, parcelles: [] }
  }
}
async function generatePDF (numeroBio, recordId) {
  const dataCurrentOperator = await fetchOperatorByNumeroBio(numeroBio)
  const { rows } = await pool
    .query(/* sql */`SELECT version_name, audit_date, annee_reference_controle, mixite,oc_label
        FROM cartobio_operators
        WHERE record_id = $1`,
    [recordId])

  const { metadata, ...record } = rows[0]

  const currentOperator = {
    ...dataCurrentOperator,
    metadata,
    ...record
  }
  const parcelles = await getAllParcelles(recordId)

  if (parcelles.length === 0) {
    console.error(`Aucune parcelle trouvée pour l'opérateur ${recordId}`)
    return { global: null, parcelles: [] }
  }

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || undefined,
    headless: true,
    args: [
      '--headless',
      '--hide-scrollbars',
      '--mute-audio',
      // WARNING : Peut-etre enlever en prod pour plus de sécurité
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  })

  const pageMap = await launchStyleTab(browser)
  const result = await generateOperatorMapImages(parcelles, pageMap)
  const page = await browser.newPage()
  const fontPath = path.join(__dirname, '../../image-map/Marianne.woff2')
  const fontData = fs.readFileSync(fontPath, { encoding: 'base64' })

  const groupedParcels = {}
  parcelles.forEach(parcel => {
    const conversionNiveau = parcel.conversion_niveau || 'Non défini'
    if (!groupedParcels[conversionNiveau]) {
      groupedParcels[conversionNiveau] = []
    }
    groupedParcels[conversionNiveau].push(parcel)
  })

  const order = ['AB', 'C3', 'C2', 'C1', 'CONV', 'Non défini']
  Object.keys(groupedParcels).forEach(niveau => {
    groupedParcels[niveau].sort((a, b) => {
      if (a.nbilot && a.nbp && b.nbilot && b.nbp) {
        return a.nbilot - b.nbilot || a.nbp - b.nbp
      }
      if (a.name && b.name) {
        return a.nom.localeCompare(b.name)
      }
      if (a.refcad && b.refcad) {
        return a.refcad[0].localeCompare(b.refcad[0])
      }
      return 0
    })
  })

  const sortedGroupedParcels = Object.fromEntries(
    Object.entries(groupedParcels).sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
    )
  )

  const groupTotals = {}
  let totalHA = 0
  Object.keys(sortedGroupedParcels).forEach(groupKey => {
    const groupSum = groupedParcels[groupKey].reduce(
      (sum, parcel) => sum + (parcel.superficie_totale_ha || 0),
      0
    )
    groupTotals[groupKey] = groupSum
    totalHA += groupSum
  })

  const blocksHTML = Object.keys(sortedGroupedParcels).map(groupKey =>
    sortedGroupedParcels[groupKey].map(item => {
      const parcelle = result.parcelles.find(e => e.id === item.id)
      const imgSrc = `data:image/png;base64,${parcelle.buffer}`
      const block = `
      <div class="block">
        <div class="container">
            <h3 class="header">${item.name ? 'Parcelle ' + item.name : ''}${item.name && item.nbilot ? ' - ' : ''}${item.nbilot ? 'Ilot ' + item.nbilot + ' parcelle ' + item.nbp : ''}${item.name == null && item.nbilot == null && item.refcad ? item.refcad.map((e) => formatRefCad(e)).join(' ; ') : ''}</h3>
            <div class="info">
              <div class="info-block"><div class="title-grey">Commune (code commune) :</div> ${item.communename} (${item.commune})</div>
            </div>
              <div class="info">
                <div class="info-block"><div class="title-grey">Date d'engagement :</div> ${item.engagement_date ? formatDate(item.engagement_date) : '-'}</div>
                <div class="info-block"><div class="title-grey">Niveau de conversion :</div> ${item.conversion_niveau === 'CONV' ? 'Conventionnel' : item.conversion_niveau || '-'}</div>
            </div>
            <div class="table-container">
                <table>
                    <tr>
                        <th class="row1">Culture</th>
                        <th class="row2">Variété de culture</th>
                        <th class="row3">Date de semis</th>
                        <th class="row4">Surface</th>
                    </tr>
                    ${item.cultures.map(e => {
                      return `
                      <tr>
                        <td>${fromCodeCpf(e.CPF).libelle_code_cpf}</td>
                        <td>${e.variete ? e.variete : '-'}</td>
                        <td>${e.date_semis ? formatDate(e.date_semis) : '-'}</td>
                        <td>${item.cultures.length === 1 ? item.superficie_totale_ha.toFixed(2).replace('.', ',') + ' ha' : e.surface ? Number(e.surface).toFixed(2).replace('.', ',') + ' ha' : '-'} </td>
                      </tr>
                      `
                    }
                    ).join('')}
                </table>
            </div>
        </div>
        <div class="map-container">
          <img src="${imgSrc}" alt="Carte de la parcelle" />
          <div class="data-global">
            <div class="title-surface">Surface graphique de la parcelle</div>
            <div class="align-left">${item.superficie_totale_ha.toFixed(2).replace('.', ',')} ha</div>
          </div>
        </div>
      </div>`
      return block
    })
      .join('')).join('')

  const finalHTML = parcelles.length % 3 !== 0
    ? blocksHTML + '</div>'
    : blocksHTML

  const content = `
    <!doctypehtml>
    <html lang=fr>
    <head>
    <meta charset=UTF-8>
    <title>PDF Dynamique</title>
    <style>body{margin:0;padding:0}
    .title-surface{color:rgba(245,245,254,1);text-align:left;}
    .data-global{text-align:center;background-color:#000091;padding:10px;font-size:12px;width:80%;margin-left:8.25%}
    .align-left{text-align:left;margin-top:2px;color:rgba(245,245,254,1);font-weight:bolder;}
    .title-grey{text-align:left;color:#777777}
    .block{display:grid;grid-template-columns:65% 35%;page-break-inside:avoid;break-inside:avoid;margin-bottom:30px;}
    // .page{page-break-after:always;display:flex;flex-direction:column}.page:last-child{page-break-after:auto}
    .header{font-size:20px;font-weight:700;margin-bottom:10px;overflow-wrap: break-word;word-break: break-word;white-space: normal;  text-overflow: ellipsis;}.container{padding:10px}.info{font-size:13px;display:flex;margin-bottom:20px;margin-top:20px;justify-content:space-between}
    .info-block{flex:1}
    .table-container{margin-top:20px;margin-bottom:20px}
    table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;border:none}
    td,th{padding:8px;text-align:left;border-bottom:.5px solid #e3e3e3}
    td { font-weight: lighter;}
    th{background-color:#000091;color:#fff}.certification{margin-top:5px;color:#777777;font-size:12px}
    .notes{font-size:12px}.map-container{margin-top:20px;text-align:center;}
    .map-container img{max-width:87.5%;margin-left:3.5%}
    @media print{.page{height:auto;min-height:auto}}
    .row1{width:30%}.row2{width:30%}.row3{width:22.5%}.row4{width:17.5%}
    </style>
    </head>
    <body>
    ${finalHTML}
    </body>
    </html>`
  await page.setContent(content)
  await page.evaluate((fontData) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    const style = document.createElement('style')
    style.innerHTML = `
      @font-face {
        font-family: 'Marianne';
        src: url(data:font/woff2;base64,${fontData}) format('woff2');
        font-style: normal;
      }
    `
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.head.appendChild(style)
  }, fontData)

  await page.evaluate(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('body').style.fontFamily = 'Marianne, sans-serif'
  })

  await page.pdf({
    path: `${numeroBio}-${recordId}-2.pdf`,
    format: 'A4',
    landscape: false,
    printBackground: true,
    margin: {
      top: '1cm',
      right: '1cm',
      bottom: '1cm',
      left: '1cm'
    }
  })

  const resumeHTML = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <style>
      .container {
        max-width: 1200px;
        background-color: #fff;
      }
        .container-bottom {
        max-width: 1200px;
        margin-top : 40px;
        background-color: #fff;
      }

      header {
        margin-bottom: 30px;
      }

      .header-top {
        display: inline-flex;
        gap: 20px;
        max-width : 65%;
        width : 60%;
      }

      .header-top .name-operator {
        font-size: 24px;
        font-weight: 700;
        color: #2b3a75;
      }

      .badge {
        background-color: #e5fbfd;
        border-radius: 4px;
        width: fit-content;
        border: 1px solid #4cb4bd;
        padding: 2px 3px;
        color: #006a6f;
        font-weight: 600;
        font-size: 12px;
        padding: auto;
        display: inline-flex;
        margin-left: 10px;
        margin-top: 10px;
      }

      .badge svg {
        margin: auto;
        display: inline-block;
      }

      .top-info {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 20px;
      }

      .top-info .left {
        padding-left: 0px;
        flex: 1 75%;
      }

      .top-info .left p {
        margin-bottom: 6px;
        font-size: 13px;
        line-height: 1.5;
        margin-left: 0px;
      }

      .table-section {
        margin-top: 10px;
      }

      .table-section h3 {
        font-size: 14px;
        margin-bottom: 15px;
        font-weight: 600;
        color: #2b3a75;
      }

      h3 {
        font-size: 14px;
        margin-bottom: 10px;
      }
      table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        margin-bottom: 20px;
        font-size: 12px !important;
        border-spacing: 0;
        min-width: 100%;
        max-width: 100%;
      }

      th,
      td {
        padding: 8px;
        text-align: left;
        border-bottom: 0.5px solid #e3e3e3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-sizing: border-box;
      }

      td {
        font-weight: lighter;
      }

      .row1 { width: 15%; }
      .row2 { width: 14%; }
      .row3 { width: 22%; }
      .row4 { width: 14%; }
      .row5 { width: 16%; }
      .row6 { width: 12%; }
      .row7 { width: 8%; }

      th {
        background-color: #000091;
        color: white;
        font-weight: bold !important;
      }
      .last-line {
        background-color: #000091;
        opacity: 0.5;
        color: white;
        font-weight: bold !important;
        border: none !important;
      }

      .last-line td {
        font-weight: bold !important;
      }

      .group-total {
        background-color: #f7f7f7;
        font-weight: bold;
      }
      .group-total td {
        font-weight: bold;
      }
      .text-right {
        text-align: right;
      }

      .ligne-header {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        margin-left: 0px;
        justify-content: space-between;
        width: 60%;
        gap: 5px;
      }
      .ligne-header > p {
        display: flex;
        flex-direction: column;
      }
      .title-header {
        font-style: normal;
        font-weight: 400;
        font-size: 14px;
        color: #777777;
      }
      .header-container {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header-left {
        flex: 1;
      }

      header {
        position: relative;
      }

      .header-right {
        position: absolute;
        top: 0;
        left: 65%;
        max-width: 700px;
      }

      .header-right img {
        width: 100%;
        max-width: 678px;
        object-fit: contain;
      }
      .title-tableau {
        font-size: 16px;
      }

      .global-ligne {
        font-weight: lighter;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <div class="header-left">
          <div class="header-top">
          <div>
            <span class="name-operator"> ${currentOperator.nom}</span>
             <div class="badge">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clip-path="url(#clip0_2361_8449)">
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M6.00023 0.500122C7.69869 0.500122 9.21196 1.57275 9.77448 3.17536C10.337 4.77797 9.82609 6.56108 8.50023 7.62262V11.0581C8.50024 11.1482 8.45183 11.2313 8.37349 11.2757C8.29514 11.3201 8.19897 11.3189 8.12173 11.2726L6.00023 9.99962L3.87873 11.2726C3.8014 11.319 3.70513 11.3201 3.62675 11.2756C3.54837 11.231 3.50003 11.1478 3.50023 11.0576V7.62262C2.17436 6.56108 1.66345 4.77797 2.22597 3.17536C2.78849 1.57275 4.30176 0.500122 6.00023 0.500122ZM7.50023 8.20862C7.02365 8.40137 6.51431 8.50018 6.00023 8.49962C5.48615 8.50018 4.9768 8.40137 4.50023 8.20862V9.73362L6.00023 8.83362L7.50023 9.73362V8.20862ZM6.00023 1.49962C4.34337 1.49962 3.00023 2.84277 3.00023 4.49962C3.00023 6.15648 4.34337 7.49962 6.00023 7.49962C7.65708 7.49962 9.00023 6.15648 9.00023 4.49962C9.00023 2.84277 7.65708 1.49962 6.00023 1.49962Z"
                    fill="#006A6F"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2361_8449">
                    <rect
                      width="12"
                      height="12"
                      fill="white"
                      transform="translate(0 -0.000366211)"
                    />
                  </clipPath>
                </defs>
              </svg>
              <div>CERTIFIÉ | ${currentOperator.annee_reference_controle}</div>
            </div>
            </div>
            </div>
          </div>
        </div>
        <div class="header-right">
          <img
            src="data:image/png;base64,${result.global.buffer}"
            alt="Carte des parcelles"
          />
        </div>
      </header>

      <div class="top-info">
        <div class="left">
          <div class="ligne-header">
            <p>
              <span class="title-header">Siret&nbsp;:</span>
              ${currentOperator.siret ? currentOperator.siret : '-'}
            </p>
            <p>
              <span class="title-header">Numéro pacage&nbsp;:</span>
              ${currentOperator.numeroPacage ? currentOperator.numeroPacage : '-'}
            </p>
            <p>
              <span class="title-header">Adresse&nbsp;:</span>
              ${currentOperator.adressesOperateurs[0].lieu ?? '-'}
              <br/>
              ${currentOperator.adressesOperateurs[0].codePostal ?? '-'}
              ${currentOperator.adressesOperateurs[0].ville ?? '-'}
            </p>
          </div>
          <div class="ligne-header">
            <p>
              <span class="title-header">Année réf. contrôle&nbsp;:</span>
              ${currentOperator.annee_reference_controle}
            </p>
            <p>
              <span class="title-header">Certifié par&nbsp;:</span>
              ${currentOperator.oc_label}
            </p>
            <p>
              <span class="title-header">Date d'audit&nbsp;:</span>
              ${currentOperator.audit_date ? formatDate(currentOperator.audit_date) : '-'}
            </p>
          </div>
          <div class="ligne-header">
            <p>
              <span class="title-header">Mixité&nbsp;:</span> ${
              currentOperator.mixite === 'AB' ? '100% AB' : currentOperator.mixite === 'ABCONV' ? 'AB/En conversion' : currentOperator.mixite === 'MIXTE' ? 'Mixte' : '-'}
            </p>
            <p>
              <span class="title-header">Nombre de parcelles&nbsp;:</span
              >${parcelles.length || '-'}
            </p>
            <p>
              <span class="title-header">Surface totale&nbsp;:</span
              >${totalHA.toFixed(2).replace('.', ',') + ' ha' || '-'}
            </p>
          </div>
        </div>
      </div>

      <div class="container-bottom">
        <h3 class="title-tableau">Tableau récapitulatif des parcelles</h3>
        <table>
          <thead>
            <tr>
              <th class="row1">Nom de la parcelle</th>
              <th class="row2">Ref. PAC / cadastre</th>
              <th class="row3">Culture(s)</th>
              <th class="row4">Date d'engagement</th>
              <th class="row5">Niveau de conversion</th>
              <th class="row6">Code commune</th>
              <th class="text-right row7">Surface</th>
            </tr>
          </thead>
          <tbody>
            ${Object.keys(sortedGroupedParcels).map(groupKey => `
            ${sortedGroupedParcels[groupKey].map(parcel => `
            <tr class="global-ligne">
              <td>${parcel.name || '-'}</td>
              <td>
                ${parcel.nbilot ? `Ilot ${parcel.nbilot || '-'} - Parcelle ${parcel.nbp || ''}` : parcel.refcad ? parcel.refcad.map((e) => formatRefCad(e)).join(' ; ') : '-'}
              </td>
              <td>
                ${(parcel.cultures || []).map(c =>
                fromCodeCpf(c.CPF).libelle_code_cpf).join(', ') || ''}
              </td>
              <td>
                ${parcel.engagement_date ? formatDate(parcel.engagement_date) : '-'}
              </td>
              <td>
                ${parcel.conversion_niveau === 'CONV' ? 'Conventionnel' : parcel.conversion_niveau || '-'}
              </td>
              <td>${parcel.commune || '-'}</td>
              <td class="text-right">
                ${(parcel.superficie_totale_ha || 0).toFixed(2).replace('.',
                ',')} ha
              </td>
            </tr>
            `).join('')}
            <tr class="group-total">
              <td colspan="4">
                Niveau de conversion ${groupKey === 'CONV' ? 'conventionnel' : groupKey}
              </td>
              <td class="text-right" colspan="2">Surface totale :</td>
              <td class="text-right">
                ${groupTotals[groupKey].toFixed(2).replace('.', ',')} ha
              </td>
            </tr>
            `).join('')}
            <tr class="last-line">
              <td class="text-right" colspan="6">
                Surface totale de l'exploitation :
              </td>
              <td class="text-right">
                ${totalHA.toFixed(2).replace('.', ',')} ha
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </body>
</html>
`
  await page.setContent(resumeHTML)
  await page.evaluate((fontData) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    const style = document.createElement('style')
    style.innerHTML = `
      @font-face {
        font-family: 'Marianne';
        src: url(data:font/woff2;base64,${fontData}) format('woff2');
        font-weight: normal;
        font-style: normal;
      }
    `
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.head.appendChild(style)
  }, fontData)

  await page.evaluate(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('body').style.fontFamily = 'Marianne, sans-serif'
  })
  await page.pdf({
    path: `${numeroBio}-${recordId}-1.pdf`,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: {
      top: '1cm',
      right: '1cm',
      bottom: '1cm',
      left: '1cm'
    },
    preferCSSPageSize: true
  })

  await page.close()

  // Page de garde

  const page2 = await browser.newPage()
  const htmlPath = path.join(__dirname, '../../image-map/gardepage.html')
  let htmlContent = fs.readFileSync(htmlPath, 'utf8')

  htmlContent = htmlContent.replace(/src="([^"]+)"/g, (match, src) => {
    if (!src.startsWith('http') && !src.startsWith('data:')) {
      const imagePath = path.join(__dirname, '../../image-map', src)
      return `src="${imageToBase64(imagePath)}"`
    }
    return match
  })
  await page2.setContent(htmlContent, {
    waitUntil: 'networkidle0'
  })
  await page2.evaluate((currentOperator) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('#nbionumber').textContent = currentOperator.numeroBio ? currentOperator.numeroBio : '-'
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('#siretnumber').textContent = currentOperator.siret ? currentOperator.siret : '-'
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('#numeropacage').textContent = currentOperator.numeroPacage ? currentOperator.numeroPacage : '-'
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('#nomog').textContent = currentOperator.nom
  }, currentOperator)
  await page2.evaluate((fontData) => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    const style = document.createElement('style')
    style.innerHTML = `
      @font-face {
        font-family: 'Marianne';
        src: url(data:font/woff2;base64,${fontData}) format('woff2');
        font-weight: normal;
        font-style: normal;
      }
    `
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.head.appendChild(style)
  }, fontData)
  await page2.evaluate(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('body').style.fontFamily = 'Marianne, sans-serif'
  })

  await page2.setViewport({
    width: 1754,
    height: 1240,
    deviceScaleFactor: 2
  })

  await setTimeout(200)

  await page2.evaluate(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    document.querySelector('body').style.fontFamily = 'Marianne, sans-serif'
  })

  await page2.pdf({
    path: `${numeroBio}-${recordId}-0.pdf`,
    format: 'A4',
    landscape: true,
    printBackground: true,
    pageRanges: '1',
    scale: 0.65,
    margin: {
      top: '0cm',
      right: '0cm',
      bottom: '0cm',
      left: '0cm'
    }
  })

  await page2.close()

  const pdfFiles = [`${numeroBio}-${recordId}-0.pdf`, `${numeroBio}-${recordId}-1.pdf`, `${numeroBio}-${recordId}-2.pdf`]

  const pdf = await mergeAndAddFooter(pdfFiles, currentOperator.nom)
  await browser.close()
  return pdf
}

module.exports = {
  generateOperatorMapImages,
  generatePDF
}
