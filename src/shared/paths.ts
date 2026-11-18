import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const isApiRoot = (dir: string): boolean => {
  const file = join(dir, 'package.json')
  return existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === '@agencebio/cartobio-api'
}

function findRootDir (from: string): string {
  let dir = from
  while (!isApiRoot(dir)) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`@agencebio/cartobio-api package.json not found above ${from}`)
    dir = parent
  }
  return dir
}

export const ROOT_DIR = findRootDir(import.meta.dirname)
export const ASSETS_DIR = join(ROOT_DIR, 'assets')
export const DATA_DIR = join(ROOT_DIR, 'data')
export const MAIL_TEMPLATES_DIR = join(ROOT_DIR, 'src/services/mailer/templates')
