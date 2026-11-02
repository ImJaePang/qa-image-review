/** 수신 배치의 처리 건수를 1 올린다. 전부 끝나면 finished_at을 서버 시각으로 기록한다. */
export async function bumpBatch(client, batchId, { failed }) {
  if (batchId == null) return
  await client.query(
    `UPDATE ingest_batches
        SET processed_count = processed_count + 1,
            failed_count    = failed_count + $2,
            finished_at     = CASE WHEN processed_count + 1 >= total_count THEN now() ELSE finished_at END
      WHERE id = $1`,
    [batchId, failed ? 1 : 0],
  )
}
