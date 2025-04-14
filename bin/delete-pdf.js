#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

/**
 * Script de nettoyage des pdfs non utile depuis plus de 2 jours (déchet d'une mauvaise génération)
 */

async function exit () {
  process.exit(1)
}

async function clearPDFS () {
  if (process.argv[2] === '-h' || process.argv[2] === '--help') {
    console.log(
      'Usage: node delete-pdf.js (-h|--help)'
    )
    process.exit(0)
  }

  try {
    fs.readdir('pdf', (err, files) => {
      if (err) throw err

      for (const file of files) {
        fs.unlink(path.join('pdf', file), (err) => {
          if (err) throw err
        })
      }
    })
  } catch (e) {
    console.error(e)
    await exit()
  }
}

(async function () {
  await clearPDFS()
})()
