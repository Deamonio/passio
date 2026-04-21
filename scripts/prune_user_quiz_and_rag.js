/**
 * 특정 사용자: 퀴즈 시도 전부 삭제, rag_solve_jobs는 생성 시각 기준 가장 이른 N건만 유지.
 *
 *   node scripts/prune_user_quiz_and_rag.js --user=USERNAME
 *   PRUNE_USERNAME=foo RAG_KEEP=10 node scripts/prune_user_quiz_and_rag.js
 */
const { Client } = require("pg");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/sikdorak";

const RAG_KEEP = Math.max(0, parseInt(process.env.RAG_KEEP || "10", 10));

function parseUserArg() {
  const a = process.argv.find(x => x.startsWith("--user="));
  if (a) return a.slice("--user=".length).trim();
  return (process.env.PRUNE_USERNAME || "").trim();
}

async function main() {
  const username = parseUserArg();
  if (!username) {
    console.error("사용법: node scripts/prune_user_quiz_and_rag.js --user=로그인아이디");
    console.error("또는 PRUNE_USERNAME 환경 변수.");
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id, username FROM users WHERE lower(username) = lower($1) LIMIT 1",
      [username]
    );
    if (!rows.length) {
      throw new Error(`사용자를 찾을 수 없습니다: ${username}`);
    }
    const uid = rows[0].id;
    console.log("user id:", uid, "username:", rows[0].username);

    // 퀴즈 삭제 전에 링크만 끊어야, 이후 단계에서 RAG 행을 created_at 기준으로 남길 수 있음
    await client.query(
      `UPDATE rag_solve_jobs
       SET quiz_attempt_id = NULL, quiz_attempt_answer_index = NULL
       WHERE user_id = $1`,
      [uid]
    );
    await client.query(
      `DELETE FROM quiz_attempt_answers
       WHERE attempt_id IN (SELECT id FROM quiz_attempts WHERE user_id = $1)`,
      [uid]
    );
    const qDel = await client.query("DELETE FROM quiz_attempts WHERE user_id = $1", [uid]);
    console.log("quiz_attempts (+answers) cleared, attempts deleted:", qDel.rowCount);

    const ragTrim = await client.query(
      `WITH keepers AS (
         SELECT id
         FROM rag_solve_jobs
         WHERE user_id = $1
         ORDER BY created_at ASC, id ASC
         LIMIT $2
       )
       DELETE FROM rag_solve_jobs r
       WHERE r.user_id = $1
         AND NOT EXISTS (SELECT 1 FROM keepers k WHERE k.id = r.id)`,
      [uid, RAG_KEEP]
    );
    console.log("rag_solve_jobs removed (kept earliest", RAG_KEEP, "by created_at):", ragTrim.rowCount);

    await client.query("COMMIT");
    console.log("done.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
