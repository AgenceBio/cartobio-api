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
  let deleted = 0

  for (const file of await readdir(directory)) {
    if (!file.toLowerCase().endsWith('.pdf')) continue

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
