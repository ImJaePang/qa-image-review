/** 지정한 pool에서 트랜잭션 실행: 성공 시 COMMIT, 예외 시 ROLLBACK */
export async function txWith(pool, fn) {
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
