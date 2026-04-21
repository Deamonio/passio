/**
 * One-off: deamon 비밀번호 변경, 퀴즈 기록 전부 삭제, AI 해설(rag_solve_jobs)은 id 오름차순 상위 10건만 유지.
 *
 * 사용:
 *   DATABASE_URL=postgresql://... DEAMON_NEW_PASSWORD='your_pw' node scripts/deamon_maintenance.js
 */
const { Client } = require("pg");
const bcrypt = require("bcrypt");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/sikdorak";

const NEW_PASSWORD = process.env.DEAMON_NEW_PASSWORD;
const RAG_KEEP = Number(process.env.DEAMON_RAG_KEEP || "10", 10);

async function main() {
  if (!NEW_PASSWORD) {
    console.error("DEAMON_NEW_PASSWORD 환경 변수를 설정하세요.");
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    const { rows: urows } = await client.query(
      "SELECT id, username FROM users WHERE lower(username) = lower($1)",
      ["deamon"]
    );
    if (!urows.length) {
      throw new Error("deamon 사용자를 찾을 수 없습니다.");
    }
    const uid = urows[0].id;
    console.log("deamon user id:", uid);

    const hash = await bcrypt.hash(NEW_PASSWORD, 12);
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, uid]);
    console.log("password updated");

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
    console.log("quiz_attempts deleted:", qDel.rowCount);

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
    console.log("rag_solve_jobs trimmed (removed rows):", ragTrim.rowCount);

    await client.query("COMMIT");
    console.log("done.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
