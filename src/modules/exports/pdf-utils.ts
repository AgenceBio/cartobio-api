import fs from 'fs'
import pdflib from 'pdf-lib'
import path from 'path'
import { fileURLToPath } from 'node:url'

import { findPdfParcelles } from './exports.repository.js'
import type { BoundingBox, MapDrawOptions, MapDrawResult, PdfParcelle } from './exports.types.js'
import { ASSETS_DIR } from '../../shared/paths.js'
import { getErrorMessage } from '../../shared/errors.js'
import type { Browser, Page } from 'puppeteer'
import { logger } from '../../config/logger.js'

const ALLOWED_PDF_HOSTS = ['openmaptiles.geo.data.gouv.fr', 'openmaptiles.data.gouv.fr', 'openmaptiles.github.io']
const PDF_ORIGIN = 'https://pdf.cartobio.invalid'
const MAPLIBRE_DIR = path.dirname(fileURLToPath(import.meta.resolve('maplibre-gl')))
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json'
}

function localPdfFile(pathname: string): string | null {
  if (pathname === '/map.html') return path.join(ASSETS_DIR, 'image-map/map.html')
  if (pathname.startsWith('/maplibre-gl/')) return path.join(MAPLIBRE_DIR, path.basename(pathname))
  return null
}

async function restrictNetwork(page: Page): Promise<void> {
  await page.setRequestInterception(true)
  page.on('request', (request): void => {
    const url = new URL(request.url())
    const localFile = url.origin === PDF_ORIGIN ? localPdfFile(url.pathname) : null
    if (localFile && fs.existsSync(localFile)) {
      void request.respond({
        status: 200,
        contentType: CONTENT_TYPES[path.extname(localFile)] ?? 'application/octet-stream',
        body: fs.readFileSync(localFile)
      })
    } else if (
      ['data:', 'blob:'].includes(url.protocol) ||
      (url.protocol === 'https:' && ALLOWED_PDF_HOSTS.includes(url.hostname))
    ) {
      void request.continue()
    } else {
      void request.abort()
    }
  })
}

/**
 * Lancer le navigateur
 */
async function launchStyleTab(browser: Browser, timeout = 30000): Promise<Page> {
  const page = await browser.newPage()
  await restrictNetwork(page)
  const filePath = `${PDF_ORIGIN}/map.html`

  try {
    await page.goto(filePath, {
      waitUntil: 'networkidle2',
      timeout: timeout
    })
    const stylePath = path.join(ASSETS_DIR, 'image-map/base.json')
    const style = await new Promise<string>((resolve, reject): void => {
      fs.readFile(stylePath, 'utf8', (err, data): void => {
        if (err) reject(err)
        else resolve(data)
      })
    })
    await page.evaluate((style): Promise<void> => {
      return new Promise<void>((resolve, reject): void => {
        const styleObject = JSON.parse(style)

        map.setStyle(styleObject)

        if (map.isStyleLoaded()) {
          resolve()
          return
        }

        map.once('style.load', (): void => {
          resolve()
        })

        map.once('error', (e): void => {
          reject(e.error)
        })

        // Timeout de sécurité
        window.setTimeout((): void => {
          reject(new Error('Timeout lors du chargement du style'))
        }, 20000)
      })
    }, style)
    return page
  } catch (error) {
    await page.close()
    throw new Error(`Timeout lors du chargement de la page avec le style ${getErrorMessage(error)}`, {
      cause: error
    })
  }
}

/**
 * Calculer le zoom optimal pour la parcelle
 */
function getOptimalZoom(bboxWidth: number, bboxHeight: number, viewportWidth: number, viewportHeight: number): number {
  const WORLD_DIM = { width: 512, height: 512 }
  const ZOOM_MAX = 20

  function latRad(lat: number): number {
    const sin = Math.sin((lat * Math.PI) / 180)
    const result = Math.log((1 + sin) / (1 - sin)) / 2
    return result
  }

  function zoom(mapPx: number, worldPx: number, fraction: number): number {
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
 * Avec `pac`, uniquement les parcelles PAC (numéro d'îlot et de parcelle)
 */
async function getAllParcelles(recordId: string, pac: boolean = false): Promise<Array<PdfParcelle>> {
  return findPdfParcelles(recordId, pac)
}

/**
 * Calcule la bounding box englobant toutes les parcelles
 */
function calculateGlobalBoundingBox(parcelles: Array<PdfParcelle>): BoundingBox | null {
  if (parcelles.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  parcelles.forEach((parcelle): void => {
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
 */
async function drawAllParcellesOnMap(
  page: Page,
  parcelles: Array<PdfParcelle>,
  { width, height, center, zoom, timeout }: MapDrawOptions
): Promise<MapDrawResult> {
  await page.setViewport({ width, height })

  await page.waitForSelector('body.loading', { hidden: true, timeout })

  await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })

  const error = await page.evaluate(
    ({ parcelles, center, zoom }) => {
      try {
        map.jumpTo({ center, zoom })

        if (map.getSource('parcelles')) {
          map.removeLayer('parcelles-layer')

          map.removeSource('parcelles')
        }
        const features = parcelles.map((parcelle) => ({
          type: 'Feature',
          geometry: JSON.parse(parcelle.geojson),
          properties: { id: parcelle.id }
        }))

        map.addSource('parcelles', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: features
          }
        })

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
        return `Erreur lors du rendu des parcelles : ${err instanceof Error ? err.message : String(err)}`
      }
    },
    { parcelles, center, zoom }
  )
  if (error) return { error }

  try {
    await page.waitForSelector('body.loading', { hidden: true, timeout })

    await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })
  } catch (err) {
    logger.error({ err }, `Timeout exceeded (${timeout}ms)`)
    return { error: `Timeout exceeded (${timeout}ms)` }
  }

  const buffer = await page.screenshot({ type: 'jpeg', encoding: 'base64', quality: 50 })
  return { buffer }
}

/**
 * Dessine toutes les parcelles avec une parcelle en surbrillance
 */
async function drawParcelleHighlightOnMap(
  page: Page,
  parcelles: Array<PdfParcelle>,
  parcelleHighlight: PdfParcelle,
  { width, height, center, zoom, timeout }: MapDrawOptions
): Promise<MapDrawResult> {
  await page.setViewport({ width, height })

  const error = await page.evaluate(
    ({ parcelles, parcelleHighlight, center, zoom }) => {
      try {
        map.jumpTo({ center, zoom })

        if (map.getSource('parcelles')) {
          map.removeLayer('parcelles-highlight-layer')

          map.removeLayer('parcelles-layer')

          map.removeSource('parcelles')
        }
        const autresParcelles = parcelles.filter((p) => p.id !== parcelleHighlight.id)
        const autresFeatures = autresParcelles.map((parcelle) => ({
          type: 'Feature',
          geometry: JSON.parse(parcelle.geojson),
          properties: {
            id: parcelle.id,
            highlight: false,
            NOM: parcelleHighlight.name,
            NUMERO_I: parcelleHighlight.nbilot,
            NUMERO_P: parcelleHighlight.nbp
          }
        }))
        const highlightFeature = {
          type: 'Feature',
          geometry: JSON.parse(parcelleHighlight.geojson),
          properties: {
            id: parcelleHighlight.id,
            highlight: true,
            NOM: parcelleHighlight.name,
            NUMERO_I: parcelleHighlight.nbilot,
            NUMERO_P: parcelleHighlight.nbp
          }
        }
        const allFeatures = [...autresFeatures, highlightFeature]

        map.addSource('parcelles', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: allFeatures
          }
        })

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
        return `Erreur lors du rendu des parcelles : ${err instanceof Error ? err.message : String(err)}`
      }
    },
    { parcelles, parcelleHighlight, center, zoom }
  )
  if (error) return { error }

  try {
    await page.waitForSelector('body.loading', { hidden: true, timeout })

    await page.waitForFunction(() => typeof map !== 'undefined' && map.isStyleLoaded(), { timeout })
  } catch (err) {
    return { error: `Timeout exceeded (${timeout}ms)`, err }
  }

  const buffer = await page.screenshot({ type: 'jpeg', encoding: 'base64', quality: 50 })
  return { buffer }
}

async function mergeAndAddFooter(
  pdfPaths: string[],
  name: string,
  deleteFilesAfter: boolean
): Promise<pdflib.PDFDocument> {
  const mergedPdf = await pdflib.PDFDocument.create()
  const copiedPages: Array<{ page: pdflib.PDFPage; docIndex: number }> = []

  for (const [docIndex, pdfPath] of pdfPaths.entries()) {
    const pdfBytes = fs.readFileSync(pdfPath)

    const pdf = await pdflib.PDFDocument.load(pdfBytes)
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())

    pages.forEach((page): void => {
      copiedPages.push({ page, docIndex })
      mergedPdf.addPage(page)
    })
  }

  copiedPages.forEach(({ page }, index): void => {
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
  if (deleteFilesAfter) {
    pdfPaths.forEach((path): void => fs.unlinkSync(path))
  }
  return mergedPdf
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

function formatRefCad(enter: string): string {
  // On retire les 5 premiers chiffres (code commune)
  const reste = enter.slice(5)
  // On sépare chiffres + lettres + chiffres
  const match = reste.match(/^(\d+)([A-Za-z]+)(\d+)$/)
  if (!match) return reste
  const [, prefixe, lettres, numero] = match
  return `${prefixe} ${lettres} ${numero}`
}

export {
  formatDate,
  getOptimalZoom,
  calculateGlobalBoundingBox,
  launchStyleTab,
  restrictNetwork,
  drawParcelleHighlightOnMap,
  drawAllParcellesOnMap,
  mergeAndAddFooter,
  getAllParcelles,
  formatRefCad
}
