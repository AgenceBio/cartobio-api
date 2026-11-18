import * as repository from './system.repository.js'
import config from '../../config/env.js'
import type { HealthAvailableResponse, HealthUnavailableResponse } from '@agencebio/cartobio-types'

export async function getHealth(): Promise<HealthAvailableResponse> {
  await repository.checkHealth()
  return { status: 'ok', db: 'ok', uptime: process.uptime(), timestamp: Date.now() }
}

export function getUnavailableHealth(): HealthUnavailableResponse {
  return { status: 'ok', db: 'unreachable', uptime: process.uptime(), timestamp: Date.now() }
}

export function getVersion(): string {
  return config.get('version')
}
