declare module 'db-migrate' {
  interface DBMigrateInstance {
    silence (isSilent: boolean): void
    up (): Promise<unknown>
    down (): Promise<unknown>
    reset (): Promise<unknown>
  }

  interface DBMigrateOptions {
    config?: Record<string, Record<string, unknown>>
    cmdOptions?: Record<string, unknown>
    env?: string
  }

  const DBMigrate: {
    getInstance (isModule: boolean, options?: DBMigrateOptions): DBMigrateInstance
  }
  export default DBMigrate
}
