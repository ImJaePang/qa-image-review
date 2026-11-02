import pg from 'pg'
import { config } from './config.mjs'

pg.types.setTypeParser(20, Number) // int8 (id, count) -> number
pg.types.setTypeParser(1700, Number) // numeric (점수) -> number
pg.types.setTypeParser(1082, (v) => v) // date -> 'YYYY-MM-DD' 문자열 그대로

export const pool = new pg.Pool(config.db)

/** 트랜잭션: fn(client) 성공 시 COMMIT, 예외 시 ROLLBACK */
export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
