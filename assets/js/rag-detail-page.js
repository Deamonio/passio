const $ = id => document.getElementById(id);

const RAG_DETAIL_MAX_WAIT_MS = 10 * 60 * 1000;
const RAG_DETAIL_POLL_MS = 3000;
const RAG_DETAIL_FETCH_TIMEOUT_MS = 60 * 1000;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJobId() {
  const params = new URLSearchParams(location.search);
  return params.get("id");
}

async function fetchJobJson(jobId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RAG_DETAIL_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`/api/rag/jobs/${encodeURIComponent(String(jobId))}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: ctrl.signal
    });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

function removeOldQblock() {
  const old = document.getElementById("rag-detail-qblock");
  if (old && old.parentNode) {
    old.parentNode.removeChild(old);
  }
}

function renderLoading(main, statusText) {
  main.innerHTML = `<section class="card panel" style="text-align:center;padding:2rem;">
    <p style="margin:0 0 .5rem;">${escapeHtml(statusText || "AI 해설을 불러오는 중입니다…")}</p>
    <p class="muted" style="margin:0;font-size:.88rem;">최대 10분까지 대기합니다. 이후에는 자동으로 중단합니다.</p>
  </section>`;
}

function renderTimeoutFailure(main) {
  removeOldQblock();
  main.innerHTML = `<section class="card panel msg err" style="text-align:center;padding:2rem;">
    <p style="margin:0 0 .75rem;font-weight:700;">시간 초과</p>
    <p style="margin:0 0 1rem;line-height:1.5;">10분이 지나도 해설이 완료되지 않았습니다. 네트워크 또는 서버 부하일 수 있습니다. 잠시 후 <a href="/pages/history.html">히스토리</a>에서 다시 확인해 주세요.</p>
    <a class="btn btn-navy btn-sm" href="/pages/history.html">히스토리로 이동</a>
  </section>`;
}

function renderJobFailed(main, message) {
  removeOldQblock();
  main.innerHTML = `<section class="card panel msg err" style="text-align:center;padding:2rem;">
    <p style="margin:0 0 .5rem;font-weight:700;">AI 해설 생성 실패</p>
    <p style="margin:0;line-height:1.5;">${escapeHtml(message || "알 수 없는 오류입니다.")}</p>
    <p style="margin:1rem 0 0;"><a class="btn btn-out btn-sm" href="/pages/history.html">히스토리로</a></p>
  </section>`;
}

function renderCompletedJob(job, main, page) {
  removeOldQblock();

  let responsePayload = job.resultPayload || {};
  if (typeof responsePayload === "string") {
    try {
      responsePayload = JSON.parse(responsePayload);
    } catch {
      responsePayload = {};
    }
  }
  if (typeof responsePayload === "string") {
    try {
      responsePayload = JSON.parse(responsePayload);
    } catch {
      responsePayload = {};
    }
  }
  const firstResult = Array.isArray(responsePayload.results) ? responsePayload.results[0] || {} : {};
  const report = firstResult.report || responsePayload.report || {};
  const body = report.body || {};
  const options = [job.option1, job.option2, job.option3, job.option4].filter(Boolean);
  const finalAnswer = job.answerChoice || body.answer || report.header?.ans || "정답 정보 없음";

  const qblock = document.createElement("section");
  qblock.className = "rag-qblock";
  qblock.id = "rag-detail-qblock";
  const userWrong = job.wrongChoice;
  let answerText = finalAnswer;
  let answerIdx = -1;
  if (/^[1-4]$/.test(String(answerText))) {
    answerIdx = parseInt(answerText, 10) - 1;
    answerText = options[answerIdx];
  } else {
    answerIdx = options.findIndex(opt => opt === answerText);
  }
  qblock.innerHTML = `
      <div class='rag-q-card'>
        <div>
          <div class='rag-q-label'>문제</div>
          <div class='rag-q-text'>${escapeHtml(job.questionText)}</div>
        </div>
        <div class='rag-q-options'>
          ${options
            .map((opt, idx) => {
              let cls = "";
              let tag = "";
              if (idx === answerIdx) {
                cls = "correct";
                tag = `<span class='q-tag'>정답</span>`;
              } else if (userWrong && opt === userWrong) {
                cls = "wrong";
                tag = `<span class='q-tag wrong'>오답</span>`;
              }
              return `<div class='rag-q-option ${cls}'>${idx + 1}) ${escapeHtml(opt)}${tag}</div>`;
            })
            .join("")}
        </div>
      </div>
    `;

  const explainHtml =
    globalThis.QuizAiBlocks && typeof globalThis.QuizAiBlocks.buildQuizAiExplainFromJob === "function"
      ? globalThis.QuizAiBlocks.buildQuizAiExplainFromJob(job)
      : "";
  main.innerHTML =
    explainHtml ||
    `<section class="card panel"><p class="muted" style="margin:0;">구조화된 해설 블록을 만들 수 없습니다.</p></section>`;

  if (main && main.parentNode) {
    main.parentNode.insertBefore(qblock, main);
  } else if (page && page.firstChild) {
    page.insertBefore(qblock, page.firstChild);
  }
}

async function loadRagDetail() {
  const id = getJobId();
  const main = $("rag-detail-main");
  const page = document.querySelector(".rag-detail-layout");
  if (!id) {
    main.innerHTML = "<section class='card panel'>잘못된 접근입니다.</section>";
    return;
  }

  const deadline = Date.now() + RAG_DETAIL_MAX_WAIT_MS;

  try {
    while (Date.now() < deadline) {
      let r;
      try {
        r = await fetchJobJson(id);
      } catch {
        renderLoading(main, "연결이 지연되고 있습니다. 다시 시도하는 중…");
        await sleep(RAG_DETAIL_POLL_MS);
        continue;
      }

      if (!r.ok) {
        main.innerHTML =
          "<section class='card panel'>기록을 불러오지 못했습니다. (권한이 없거나 존재하지 않는 작업입니다.)</section>";
        return;
      }

      let d;
      try {
        d = await r.json();
      } catch {
        await sleep(RAG_DETAIL_POLL_MS);
        continue;
      }

      const job = d.job;
      if (!job) {
        main.innerHTML = "<section class='card panel'>기록을 불러오지 못했습니다.</section>";
        return;
      }

      const st = job.status;
      if (st === "completed") {
        renderCompletedJob(job, main, page);
        return;
      }
      if (st === "failed") {
        renderJobFailed(main, job.errorMessage || "해설 생성에 실패했습니다.");
        return;
      }

      const remainSec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      renderLoading(
        main,
        st === "processing" ? "AI가 해설을 작성하는 중입니다…" : "작업 대기 중입니다…"
      );
      const hint = main.querySelector(".muted");
      if (hint) {
        hint.textContent = `남은 대기 시간 약 ${Math.floor(remainSec / 60)}분 ${remainSec % 60}초 (최대 10분)`;
      }
      await sleep(RAG_DETAIL_POLL_MS);
    }

    renderTimeoutFailure(main);
  } catch (e) {
    main.innerHTML = "<section class='card panel'>기록을 불러오지 못했습니다.</section>";
  }
}

loadRagDetail();
