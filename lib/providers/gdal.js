const gdal = require('gdal-async')
const { mkdtemp, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const AdmZip = require('adm-zip')

const wgs84 = gdal.SpatialReference.fromProj4('+init=epsg:4326')

/**
 * Unzip geographical files into a temporary directory
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ path: string, files: string[], cleanup: () => Promise<>}>}
 */
async function unzipGeographicalContent (buffer) {
  const zip = new AdmZip(buffer)

  const entries = zip.getEntries().filter(entry => /(.sh[xp]|.dbf)$/.test(entry.entryName))
  const toDir = await mkdtemp(join(tmpdir(), 'cartobio-anygeo-'))

  // extracts geo files but keep only the root .shp (.shx will be read as a companion file anyway)
  const files = entries.map(entry => {
    zip.extractEntryTo(entry, toDir, false, true, false)
    return join(toDir, entry.name)
  }).filter(filename => filename.endsWith('.shp'))

  return {
    path: toDir,
    files,
    cleanup: async () => rm(toDir, { recursive: true })
  }
}

module.exports = {
  unzipGeographicalContent,
  wgs84
}
