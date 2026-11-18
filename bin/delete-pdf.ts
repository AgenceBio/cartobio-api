#!/usr/bin/env node

import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import config from '../src/config/env.js'
import { db } from '../src/database/database.js'
import { findKeptAttestationsPaths } from '../src/modules/exports/exports.repository.js'

if (process.argv[2] === '-h' || process.argv[2] === '--help') {
  console.log('Usage: npm run cron:clean-pdf')
  process.exit(0)
}

const directory = config.get('attestationsProductions.directory')
const oneHourInMs = 60 * 60 * 1000

try {
  const keptPaths = new Set((await findKeptAttestationsPaths()).map((keptPath) => path.resolve(keptPath)))
  const files = (await readdir(directory)).filter((file) => file.toLowerCase().endsWith('.pdf'))
  const versions = new Map<string, Array<{ file: string; version: number }>>()
  for (const file of files) {
    const match = /^(.+_(?:complet|PAC)_\d+)_(\d+)\.pdf$/i.exec(file)
    if (!match?.[1] || !match[2]) continue
    versions.set(match[1], [...(versions.get(match[1]) ?? []), { file, version: Number(match[2]) }])
  }
  for (const fileVersions of versions.values()) {
    fileVersions
      .sort((a, b) => b.version - a.version)
      .slice(0, 2)
      .forEach(({ file }) => keptPaths.add(path.resolve(directory, file)))
  }
  let deleted = 0

  for (const file of files) {
    const filePath = path.resolve(directory, file)
    if (keptPaths.has(filePath)) continue

    const stats = await stat(filePath)
    if (Date.now() - stats.mtime.getTime() < oneHourInMs) continue

    await unlink(filePath)
    deleted++
  }

  console.log(deleted, 'PDF supprimés')
} finally {
  await db.$client.end()
}
