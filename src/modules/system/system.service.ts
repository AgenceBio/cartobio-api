import * as repository from './system.repository.js'
import config from '../../config/env.js'
import type { HealthAvailableResponse, HealthUnavailableResponse } from '@agencebio/cartobio-types'

async function getHealth (): Promise<HealthAvailableResponse> {
  await repository.checkHealth()
  return { status: 'ok', db: 'ok', uptime: process.uptime(), timestamp: Date.now() }
}

function getUnavailableHealth (): HealthUnavailableResponse {
  return { status: 'ok', db: 'unreachable', uptime: process.uptime(), timestamp: Date.now() }
}

export const getVersion = (): string => config.get('version')
export { getHealth, getUnavailableHealth }
