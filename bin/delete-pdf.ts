#!/usr/bin/env node

import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import config from '../src/config/env.js'

if (process.argv[2] === '-h' || process.argv[2] === '--help') {
  console.log('Usage: npm run cron:clean-pdf')
  process.exit(0)
}

const directory = config.get('attestationsProductions.directory')
const now = Date.now()
const twoDaysInMs = 2 * 24 * 60 * 60 * 1000

for (const file of await readdir(directory)) {
  if (!file.toLowerCase().endsWith('.pdf')) continue

  const filePath = path.join(directory, file)
  const stats = await stat(filePath)

  if (now - stats.mtime.getTime() > twoDaysInMs) {
    await unlink(filePath)
  }
}
