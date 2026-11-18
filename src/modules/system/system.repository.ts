import pool from '../../database/database.js'
const isHealthy = () => pool.query('SELECT 1')

export { isHealthy as checkHealth }
