const fs = require('fs')
const pdflib = require('pdf-lib')
const path = require('path')
const { setTimeout } = require('node:timers/promises')

const pool = require('../db.js')

/**
 * Lancer le navigateur
 * @param {Object} browser
 * @param {Object} styleConfig
 * @param {string} styleConfig.name
 * @param {string} [styleConfig.styleUrl]
 * @returns {Promise<Object>}
 */
async function launchStyleTab (browser, timeout = 30000) {
  const page = await browser.newPage()
  const filePath = `file://${path.resolve(__dirname, '../../image-map/map.html')}`

  try {
    await page.goto(filePath, {
      waitUntil: 'networkidle2',
      timeout: timeout
    })
    const stylePath = path.resolve(__dirname, '../../image-map/base.json')
    const style = await new Promise((resolve, reject) => {
      fs.readFile(stylePath, 'utf8', (err, data) => {
        if (err) reject(err)
        else resolve(data)
      })
    })
    await page.evaluate(
      (style) => {
        return new Promise((resolve, reject) => {
          const styleObject = JSON.parse(style)
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.setStyle(styleObject)

          // @ts-ignore
          // eslint-disable-next-line no-undef
          if (map.isStyleLoaded()) {
            resolve()
            return
          }

          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.once('style.load', () => {
            resolve()
          })

          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.once('error', (e) => {
            reject(e.error)
          })

          // Timeout de sécurité
          // @ts-ignore
          // eslint-disable-next-line no-undef
          setTimeout(() => {
            reject(new Error('Timeout lors du chargement du style'))
          }, 20000)
        })
      },
      style
    )
    return page
  } catch (error) {
    await page.close()
    throw new Error(`Timeout lors du chargement de la page avec le style ${error.message}`)
  }
}

/**
 * Calculer le zoom optimal pour la parcelle
 * @param {number} bboxWidth
 * @param {number} bboxHeight
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {number}
 */
function getOptimalZoom (bboxWidth, bboxHeight, viewportWidth, viewportHeight) {
  const WORLD_DIM = { width: 512, height: 512 }
  const ZOOM_MAX = 20

  function latRad (lat) {
    const sin = Math.sin((lat * Math.PI) / 180)
    const result = Math.log((1 + sin) / (1 - sin)) / 2
    return result
  }

  function zoom (mapPx, worldPx, fraction) {
    return Math.floor(Math.log(mapPx / worldPx / fraction) / Math.LN2)
  }

  const latFraction = (latRad(bboxHeight) - latRad(0)) / Math.PI
  const lngFraction = bboxWidth / 360

  const zoomX = zoom(viewportWidth, WORLD_DIM.width, lngFraction)
  const zoomY = zoom(viewportHeight, WORLD_DIM.height, latFraction)

  return Math.min(zoomX, zoomY, ZOOM_MAX)
}

/**
 * Récupère toutes les parcelles d'un opérateur
 * @param {string} recordId - L'ID de l'enregistrement de l'opérateur
 * @returns {Promise<Array>} - Tableau des parcelles
 */
async function getAllParcelles (recordId) {
  try {
    const result = await pool.query(/* sql */`
    SELECT
     cp.id,
     cp.name,
     cp.cultures,
     cp.conversion_niveau,
     cp.commune,
     c.nom as communename,
     cp.created,
     cp.engagement_date,
     cp.numero_ilot_pac AS nbilot,
     cp.numero_parcelle_pac AS nbp,
     cp.reference_cadastre as refcad,
     ST_AsGeoJSON(cp.geometry) AS geojson,
     ST_XMin(cp.geometry) AS minX,
     ST_YMin(cp.geometry) AS minY,
     ST_XMax(cp.geometry) AS maxX,
     ST_YMax(cp.geometry) AS maxY,
     ST_X(ST_Centroid(cp.geometry)) AS centerX,
     ST_Y(ST_Centroid(cp.geometry)) AS centerY,
     COALESCE(SUM(ST_Area(to_legal_projection(cp.geometry)) / 10000), 0) AS superficie_totale_ha
      FROM cartobio_parcelles cp
      JOIN communes c ON c.code = commune
      WHERE record_id = $1
      GROUP BY cp.id, cp.name, cp.cultures, cp.conversion_niveau, cp.created, cp.numero_ilot_pac, cp.numero_parcelle_pac, cp.geometry,cp.engagement_date,cp.commune,cp.reference_cadastre,c.nom;
      `,
    [recordId]
    )

    return result.rows.map(row => ({
      id: row.id,
      geojson: JSON.parse(row.geojson),
      ...row
    }))
  } catch (error) {
    console.error('Erreur lors de la récupération des parcelles:', error)
    return []
  }
}

/**
 * Calcule la bounding box englobant toutes les parcelles
 * @param {Array} parcelles - Tableau de parcelles
 * @returns {Object} - Bounding box et centre
 */
function calculateGlobalBoundingBox (parcelles) {
  if (parcelles.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  parcelles.forEach(parcelle => {
    minX = Math.min(minX, parcelle.minx)
    minY = Math.min(minY, parcelle.miny)
    maxX = Math.max(maxX, parcelle.maxx)
    maxY = Math.max(maxY, parcelle.maxy)
  })

  return {
    minx: minX,
    miny: minY,
    maxx: maxX,
    maxy: maxY,
    centerx: (minX + maxX) / 2,
    centery: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY
  }
}

/**
 * Dessine toutes les parcelles sur la carte
 * @param {Object} page - Page Puppeteer
 * @param {Array} parcelles - Tableau des parcelles à dessiner
 * @param {Object} options - Options de dessin
 * @returns {Promise<Object>} - Résultat avec buffer ou erreur
 */
async function drawAllParcellesOnMap (page, parcelles, { width, height, center, zoom, timeout }) {
  await page.setViewport({ width, height })

  await page.waitForSelector('body.loading', { hidden: true, timeout })
  // @ts-ignore
  // eslint-disable-next-line no-undef
  await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })

  const error = await page.evaluate(
    ({ parcelles, center, zoom }) => {
      try {
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.jumpTo({ center, zoom })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        if (map.getSource('parcelles')) {
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeLayer('parcelles-layer')
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeSource('parcelles')
        }
        const features = parcelles.map(parcelle => ({
          type: 'Feature',
          geometry: JSON.parse(parcelle.geojson),
          properties: { id: parcelle.id }
        }))
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addSource('parcelles', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: features
          }
        })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addLayer({
          id: 'parcelles-layer',
          type: 'fill',
          source: 'parcelles',
          paint: {
            'fill-color': 'rgba(240, 238, 237, 0.8)',
            'fill-outline-color': 'blue'
          }
        })
        return null
      } catch (err) {
        return `Erreur lors du rendu des parcelles : ${err.message}`
      }
    },
    { parcelles, center, zoom }
  )
  if (error) return { error }

  try {
    await page.waitForSelector('body.loading', { hidden: true, timeout })
    // @ts-ignore
    // eslint-disable-next-line no-undef
    await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })
  } catch (err) {
    return { error: `Timeout exceeded (${timeout}ms)` }
  }

  const buffer = await page.screenshot({ type: 'png', encoding: 'base64' })
  return { buffer }
}

/**
 * Dessine toutes les parcelles avec une parcelle en surbrillance
 * @param {Object} page - Page Puppeteer
 * @param {Array} parcelles - Tableau de toutes les parcelles
 * @param {Object} parcelleHighlight - Parcelle à mettre en surbrillance
 * @param {Object} options - Options de dessin
 * @returns {Promise<Object>} - Résultat avec buffer ou erreur
 */
async function drawParcelleHighlightOnMap (page, parcelles, parcelleHighlight, { width, height, center, zoom, timeout }) {
  await page.setViewport({ width, height })

  // @ts-ignore
  // eslint-disable-next-line no-undef
  const error = await page.evaluate(
    ({ parcelles, parcelleHighlight, center, zoom }) => {
      try {
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.jumpTo({ center, zoom })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        if (map.getSource('parcelles')) {
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeLayer('parcelles-highlight-layer')
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeLayer('parcelles-layer')
          // @ts-ignore
          // eslint-disable-next-line no-undef
          map.removeSource('parcelles')
        }
        const autresParcelles = parcelles.filter(p => p.id !== parcelleHighlight.id)
        const autresFeatures = autresParcelles.map(parcelle => ({
          type: 'Feature',
          geometry: JSON.parse(parcelle.geojson),
          properties: { id: parcelle.id, highlight: false, NOM: parcelleHighlight.name, NUMERO_I: parcelleHighlight.nbilot, NUMERO_P: parcelleHighlight.nbp }
        }))
        const highlightFeature = {
          type: 'Feature',
          geometry: JSON.parse(parcelleHighlight.geojson),
          properties: { id: parcelleHighlight.id, highlight: true, NOM: parcelleHighlight.name, NUMERO_I: parcelleHighlight.nbilot, NUMERO_P: parcelleHighlight.nbp }
        }
        const allFeatures = [...autresFeatures, highlightFeature]
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addSource('parcelles', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: allFeatures
          }
        })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addLayer({
          id: 'parcelles-layer',
          type: 'fill',
          source: 'parcelles',
          filter: ['!', ['get', 'highlight']],
          paint: {
            'fill-color': 'rgba(240, 238, 237, 0.8)',
            'fill-outline-color': 'blue'
          }
        })
        // @ts-ignore
        // eslint-disable-next-line no-undef
        map.addLayer({
          id: 'parcelles-highlight-layer',
          type: 'fill',
          source: 'parcelles',
          filter: ['==', ['get', 'highlight'], true],
          paint: {
            'fill-color': 'rgba(99, 98, 183, 0.9)',
            'fill-outline-color': 'blue'
          }
        })
        return null
      } catch (err) {
        return `Erreur lors du rendu des parcelles : ${err.message}`
      }
    },
    { parcelles, parcelleHighlight, center, zoom }
  )
  if (error) return { error }

  try {
    await page.waitForSelector('body.loading', { hidden: true, timeout })
    // @ts-ignore
    // eslint-disable-next-line no-undef
    await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })
  } catch (err) {
    return { error: `Timeout exceeded (${timeout}ms)` }
  }

  const buffer = await page.screenshot({ type: 'png', encoding: 'base64' })
  return { buffer }
}

async function mergeAndAddFooter (pdfPaths, name) {
  const mergedPdf = await pdflib.PDFDocument.create()
  const copiedPages = []

  for (const [docIndex, pdfPath] of pdfPaths.entries()) {
    const pdfBytes = fs.readFileSync(pdfPath)
    // @ts-ignore Dans la doc, c'est normal
    // eslint-disable-next-line no-undef
    const pdf = await pdflib.PDFDocument.load(pdfBytes)
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())

    pages.forEach((page) => {
      copiedPages.push({ page, docIndex })
      mergedPdf.addPage(page)
    })
  }

  copiedPages.forEach(({ page }, index) => {
    if (index > 0) {
      const { width } = page.getSize()
      const fontSize = 9
      const text = `${index + 1}`

      page.drawText(text, {
        x: width - 38,
        y: 20,
        size: fontSize
      })

      page.drawText(name, {
        x: 38,
        y: 20,
        size: fontSize
      })
    }
  })

  pdfPaths.forEach((path) => fs.unlinkSync(path))

  return mergedPdf
}

function imageToBase64 (imagePath) {
  try {
    const ext = path.extname(imagePath).substring(1)
    const data = fs.readFileSync(imagePath).toString('base64')
    return `data:image/${ext};base64,${data}`
  } catch (error) {
    console.error(`Erreur chargement image ${imagePath}:`, error)
    return ''
  }
}

function formatDate (dateStr) {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

function formatRefCad (enter) {
  // On retire les 5 premiers chiffres (code commune)
  const reste = enter.slice(5)
  // On sépare chiffres + lettres + chiffres
  const match = reste.match(/^(\d+)([A-Za-z]+)(\d+)$/)
  if (!match) return reste
  const [, prefixe, lettres, numero] = match
  return `${prefixe} ${lettres} ${numero}`
}

module.exports = {
  formatDate,
  getOptimalZoom,
  calculateGlobalBoundingBox,
  launchStyleTab,
  drawParcelleHighlightOnMap,
  drawAllParcellesOnMap,
  mergeAndAddFooter,
  getAllParcelles,
  imageToBase64,
  formatRefCad
}
