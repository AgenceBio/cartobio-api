import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const isApiRoot = (dir: string): boolean => {
  const file = join(dir, 'package.json')
  return existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === '@agencebio/cartobio-api'
}

function findRootDir(from: string): string {
  let dir = from
  while (!isApiRoot(dir)) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`package.json de @agencebio/cartobio-api introuvable au-dessus de ${from}`)
    dir = parent
  }
  return dir
}

export const ROOT_DIR = findRootDir(import.meta.dirname)
export const ASSETS_DIR = join(ROOT_DIR, 'assets')
export const DATA_DIR = join(ROOT_DIR, 'data')
export const MAIL_TEMPLATES_DIR = join(ROOT_DIR, 'src/services/mailer/templates')
export const SCRIPTS_OUTPUT_DIR = join(ROOT_DIR, 'storage/scripts')

export function scriptOutputPath(filename: string): string {
  mkdirSync(SCRIPTS_OUTPUT_DIR, { recursive: true, mode: 0o700 })
  return join(SCRIPTS_OUTPUT_DIR, filename)
}
