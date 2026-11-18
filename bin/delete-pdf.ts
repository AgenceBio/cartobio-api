#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
/**
 * Script de nettoyage des pdfs non utile depuis plus de 2 jours (déchet d'une mauvaise génération)
 */
async function exit (): Promise<void> {
  process.exit(1)
}

async function clearPDFS (): Promise<void> {
  if (process.argv[2] === '-h' || process.argv[2] === '--help') {
    console.log(
      'Usage: node delete-pdf.js (-h|--help)'
    )
    process.exit(0)
  }

  try {
    fs.readdir('storage/pdf', (err, files): void => {
      if (err) throw err

      const now = Date.now()
      const twoDaysInMs = 2 * 24 * 60 * 60 * 1000

      for (const file of files) {
        if (file.toLowerCase().endsWith('.pdf')) {
          const filePath = path.join('storage/pdf', file)

          fs.stat(filePath, (err, stats): void => {
            if (err) throw err
            const fileAge = now - stats.mtime.getTime()

            if (fileAge > twoDaysInMs) {
              fs.unlink(filePath, (err): void => {
                if (err) throw err
              })
            }
          })
        }
      }
    })
  } catch (e) {
    console.error(e)
    await exit()
  }
}

(async function (): Promise<void> {
  await clearPDFS()
})()
