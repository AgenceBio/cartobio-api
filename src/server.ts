import { access, constants } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import app from './app.js'
import config from './config/env.js'
import { sql } from 'drizzle-orm'
import { db, firstRow } from './database/database.js'
import { failInterruptedImportJobs } from './modules/imports/imports.repository.js'
import { failInterruptedAttestationsProductions } from './modules/exports/exports.repository.js'

export async function start(): Promise<void> {
  try {
    await access(config.get('attestationsProductions.directory'), constants.W_OK)

    const { rows } = await db.execute<{ server_version: string }>(sql`SHOW server_version`)
    app.log.info(`Postgres connection established, v${firstRow(rows).server_version}`)

    const interruptedJobs = await failInterruptedImportJobs()
    if (interruptedJobs > 0) app.log.warn(`${interruptedJobs} import(s) interrompu(s) passé(s) en erreur`)
    const interruptedPdfs = await failInterruptedAttestationsProductions()
    if (interruptedPdfs > 0) app.log.warn(`${interruptedPdfs} attestation(s) interrompue(s) passée(s) en erreur`)

    await app.ready()
    app.swagger()

    const address = await app.listen({
      host: config.get('host'),
      port: config.get('port')
    })

    app.log.info(`Running env:${config.get('env')} on ${address}`)

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, (): void => {
        app.log.info(`${signal} reçu, arrêt du serveur`)
        app.close().then(
          (): void => {
            process.exitCode = 0
          },
          (error: unknown): void => {
            app.log.error(error, 'Arrêt du serveur en échec')
            process.exitCode = 1
          }
        )
      })
    }
  } catch (error) {
    app.log.error(error, 'Failed to start server')
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start()
}
