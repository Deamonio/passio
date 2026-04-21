/**
 * 특정 퀴즈 시도(attempt)에 연결된 rag_solve_jobs 행만 삭제 → 퀴즈 상세에서 문항별 AI 해설을 다시 신청할 수 있음.
 *
 *   node scripts/delete_rag_jobs_for_quiz_attempt.js 64
 *   QUIZ_ATTEMPT_ID=64 node scripts/delete_rag_jobs_for_quiz_attempt.js
 */
const { Client } = require("pg");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/sikdorak";

function readAttemptId() {
  const fromEnv = process.env.QUIZ_ATTEMPT_ID;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return Number(fromEnv);
  }
  const a = process.argv[2];
  return a != null ? Number(a) : NaN;
}

async function main() {
  const attemptId = readAttemptId();
  if (!Number.isInteger(attemptId) || attemptId <= 0) {
    console.error("사용법: node scripts/delete_rag_jobs_for_quiz_attempt.js <attemptId>");
    console.error("예: node scripts/delete_rag_jobs_for_quiz_attempt.js 64");
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const own = await client.query(
      `SELECT id FROM quiz_attempts WHERE id = $1 LIMIT 1`,
      [attemptId]
    );
    if (!own.rows.length) {
      console.error(`quiz_attempts 에 id=${attemptId} 가 없습니다.`);
      process.exit(1);
    }
    const del = await client.query(
      `DELETE FROM rag_solve_jobs WHERE quiz_attempt_id = $1 RETURNING id`,
      [attemptId]
    );
    console.log(`quiz_attempt_id=${attemptId} 인 RAG job ${del.rowCount}건 삭제됨.`);
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
