const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readTargetRagJobId() {
  const params = new URLSearchParams(location.search);
  const id = Number(params.get("ragJobId"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const r = String(s % 60).padStart(2, "0");
  return `${m}:${r}`;
}

async function loadMe() {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!r.ok) { location.href = "/pages/login.html"; return null; }
    const d = await r.json();
    const full = d.user?.name || d.user?.username || "학습자";
    $("user-name").textContent = full;
    $("ava-history").textContent = full;
    $("ava-history").title = full;
    return full;
  } catch (e) {
    location.href = "/pages/login.html";
    return null;
  }
}

async function doLogout() {
  try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch (e) {}
  location.href = "/pages/index.html";
}

function renderAttemptCard(attempt) {
  const wrap = document.createElement("article");
  wrap.className = "card history-card";
  const quizIdLabel = attempt.quizUid ? `<span class='dash-chip'>Quiz ID ${attempt.quizUid}</span>` : "";
  const wrongCount = attempt.totalQuestions - attempt.correctCount;
  wrap.innerHTML = `
    <div class='history-head'>
      <div class='history-head-left'>
        <span class='history-type-badge quiz'>퀴즈</span>
        <div>
          <strong class='history-title'>세션 #${attempt.id}</strong>
          <div class='muted' style='font-size:12px;margin-top:2px;'>${fmtDate(attempt.createdAt)}</div>
        </div>
      </div>
      <div class='history-result-summary'>
        <span class='history-result-chip ok'><strong>${attempt.correctCount}</strong> 정답</span>
        <span class='history-result-chip ng'><strong>${wrongCount}</strong> 오답</span>
        <span class='muted' style='font-size:12px;'>${fmtDuration(attempt.durationSec)}</span>
      </div>
    </div>
    <div class='history-meta'>
      ${quizIdLabel}
      <span class='dash-chip'>총 ${attempt.totalQuestions}문제</span>
    </div>
    <div class='history-detail' id='attempt-detail-${attempt.id}'></div>`;
  return wrap;
}

function renderAttemptDetail(container, attempt) {
  const answers = Array.isArray(attempt.answers) ? attempt.answers : [];
  if (!answers.length) { container.innerHTML = "<p class='muted'>상세 답안이 없습니다.</p>"; return; }
  container.innerHTML = answers.map((a, idx) => `
    <div class='answer-item ${a.isCorrect ? "ok" : "ng"}'>
      <div class='answer-item-head'>
        <span class='answer-badge ${a.isCorrect ? "ok" : "ng"}'>${a.isCorrect ? "정답" : "오답"}</span>
        <span class='answer-subject'>${escapeHtml(a.subject || "")}</span>
      </div>
      <div class='answer-q'>${idx + 1}. ${escapeHtml(a.questionText || "문항 정보 없음")}</div>
      <div class='tags'>
        <span class='tag ${a.isCorrect ? "ok" : "ng"}'>내 선택: ${a.selectedIndex === null || a.selectedIndex === undefined ? "미선택" : `${a.selectedIndex + 1}번`}</span>
        <span class='tag ok'>정답: ${Number(a.correctIndex) + 1}번</span>
      </div>
    </div>`).join("");
}

function renderRagJobCard(job) {
  const wrap = document.createElement("article");
  wrap.className = "card history-card rag-history-card";
  const statusLabel = job.status === "completed" ? "완료" : job.status === "failed" ? "실패" : job.status === "processing" ? "분석 중" : "대기 중";
  const badgeClass = job.status === "completed" ? "ok" : job.status === "failed" ? "ng" : "pending";
  wrap.innerHTML = `
    <div class='history-head'>
      <div class='history-head-left'>
        <span class='history-type-badge rag'>AI 해설</span>
        <div>
          <strong class='history-title'>AI 해설 #${job.id}</strong>
          <div class='muted' style='font-size:12px;margin-top:2px;'>${fmtDate(job.createdAt)}</div>
        </div>
      </div>
      <div class='status-pill ${badgeClass}'>${statusLabel}</div>
    </div>
    <div class='history-question-preview'>${escapeHtml(job.questionText || "문항 정보 없음")}</div>
    <div class='history-detail' id='rag-detail-${job.id}'></div>`;
  return wrap;
}

function renderRagJobDetail(container, job) {
  if (!job) { container.innerHTML = "<p class='muted'>AI 해설 상세 정보를 찾을 수 없습니다.</p>"; return; }

  if (job.status === "pending" || job.status === "processing") {
    container.innerHTML = `<section class='card panel' style='text-align:center;padding:2rem;'>
      <div class='loading-spinner' aria-hidden='true' style='margin:0 auto 1rem;'></div>
      <p style='margin:0;'>AI가 해설을 생성하는 중입니다…</p>
      <p class='muted' style='margin:.5rem 0 0;font-size:.85rem;'>완료 시 자동으로 표시됩니다.</p>
    </section>`;
    const jobId = job.id;
    const pollTimer = setInterval(async () => {
      try {
        const rr = await fetch(`/api/rag/jobs/${jobId}`, { credentials: "same-origin", cache: "no-store" });
        const dd = await rr.json();
        const updated = dd.job || {};
        if (updated.status === "completed" || updated.status === "failed") {
          clearInterval(pollTimer);
          renderRagJobDetail(container, updated);
        }
      } catch (_) {}
    }, 5000);
    return;
  }

  if (job.status === "failed") {
    container.innerHTML = `<section class='card panel'>해설 생성에 실패했습니다. ${escapeHtml(job.errorMessage || "")}</section>`;
    return;
  }

  let responsePayload = job.resultPayload || {};
  if (typeof responsePayload === "string") { try { responsePayload = JSON.parse(responsePayload); } catch (e) { responsePayload = {}; } }
  if (typeof responsePayload === "string") { try { responsePayload = JSON.parse(responsePayload); } catch (e) { responsePayload = {}; } }

  const firstResult = Array.isArray(responsePayload.results) ? (responsePayload.results[0] || {}) : {};
  const report = firstResult.report || responsePayload.report || {};
  const body = report.body || {};
  const finalAnswer = job.answerChoice || body.answer || report.header?.ans || "정답 정보 없음";
  const options = [job.option1, job.option2, job.option3, job.option4].filter(Boolean);

  const explainHtml =
    window.QuizAiBlocks && typeof window.QuizAiBlocks.buildQuizAiExplainFromJob === "function"
      ? window.QuizAiBlocks.buildQuizAiExplainFromJob(job)
      : "";

  container.innerHTML = `
    <section class="card quiz-detail-card">
      <div class="quiz-detail-head"><h3 style="margin:0;font-size:1rem;">입력 문제</h3></div>
      <div class="rag-detail-question" style="margin-top:10px;">${escapeHtml(job.questionText)}</div>
      <div class="rag-option-list" style="margin-top:12px;">${options.map((opt, idx) => `<div class='rag-option-item'>${idx + 1}) ${escapeHtml(opt)}</div>`).join("")}</div>
      <div class="tags" style="margin-top:12px;">
        ${job.wrongChoice ? `<span class='tag ng'>내가 고른 오답: ${escapeHtml(job.wrongChoice)}</span>` : ""}
        <span class='tag ok'>정답: ${escapeHtml(finalAnswer)}</span>
      </div>
    </section>
    ${explainHtml || "<p class='muted' style='margin:12px 0 0;'>구조화된 해설을 표시할 수 없습니다.</p>"}
  `;
}

/** 최근 페이지 크기(서버 최대 500). 실시간 갱신은 이 구간만 교체하고, 더보기로 붙인 예전 tail 은 유지합니다. */
const HISTORY_HEAD_LIMIT = 500;

function makeQuizAttemptCard(attempt, listSlot) {
  const card = renderAttemptCard(attempt);
  card.dataset.listSlot = listSlot;
  card.style.cursor = "pointer";
  card.onclick = () => {
    window.location.href = `/pages/quiz-attempt.html?id=${attempt.id}`;
  };
  return card;
}

function makeRagJobCard(job, listSlot) {
  const card = renderRagJobCard(job);
  card.dataset.listSlot = listSlot;
  card.style.cursor = "pointer";
  card.onclick = () => {
    window.location.href = `/pages/rag-detail.html?id=${job.id}`;
  };
  return card;
}

function replaceQuizHeadInDom(attempts) {
  const list = $("quiz-history-list");
  const empty = $("quiz-history-empty");
  if (!list || !empty) {
    return;
  }
  list.querySelectorAll('[data-list-slot="head"]').forEach(n => n.remove());
  const hasTail = Boolean(list.querySelector('[data-list-slot="tail"]'));
  if (!attempts.length && !hasTail) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  if (attempts.length) {
    empty.style.display = "none";
  }
  const anchor = list.querySelector('[data-list-slot="tail"]');
  /* API: created_at DESC → [0]=최신. tail 없을 때 appendChild 순서대로 넣어야 최신이 위(먼저)임 */
  if (anchor) {
    let ref = anchor;
    for (let i = attempts.length - 1; i >= 0; i -= 1) {
      const c = makeQuizAttemptCard(attempts[i], "head");
      list.insertBefore(c, ref);
      ref = c;
    }
  } else {
    for (let i = 0; i < attempts.length; i += 1) {
      list.appendChild(makeQuizAttemptCard(attempts[i], "head"));
    }
  }
}

function replaceRagHeadInDom(jobs) {
  const list = $("rag-history-list");
  const empty = $("rag-history-empty");
  if (!list || !empty) {
    return;
  }
  list.querySelectorAll('[data-list-slot="head"]').forEach(n => n.remove());
  const hasTail = Boolean(list.querySelector('[data-list-slot="tail"]'));
  if (!jobs.length && !hasTail) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  if (jobs.length) {
    empty.style.display = "none";
  }
  const anchor = list.querySelector('[data-list-slot="tail"]');
  if (anchor) {
    let ref = anchor;
    for (let i = jobs.length - 1; i >= 0; i -= 1) {
      const c = makeRagJobCard(jobs[i], "head");
      list.insertBefore(c, ref);
      ref = c;
    }
  } else {
    for (let i = 0; i < jobs.length; i += 1) {
      list.appendChild(makeRagJobCard(jobs[i], "head"));
    }
  }
}

let quizNextOlderOffset = null;
let ragNextOlderOffset = null;

function setQuizMoreButton() {
  const btn = $("btn-quiz-history-more");
  if (!btn) {
    return;
  }
  if (quizNextOlderOffset == null) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "inline-flex";
}

function setRagMoreButton() {
  const btn = $("btn-rag-history-more");
  if (!btn) {
    return;
  }
  if (ragNextOlderOffset == null) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "inline-flex";
}

async function loadQuizHistoryHead() {
  const list = $("quiz-history-list");
  if (!list) {
    return;
  }
  try {
    const r = await fetch(`/api/quiz/history?limit=${HISTORY_HEAD_LIMIT}&offset=0`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!r.ok) {
      throw new Error();
    }
    const d = await r.json();
    const attempts = Array.isArray(d.attempts) ? d.attempts : [];
    replaceQuizHeadInDom(attempts);
    quizNextOlderOffset = d.hasMore ? attempts.length : null;
    setQuizMoreButton();
  } catch (e) {
    if (!list.querySelector(".history-card")) {
      list.innerHTML = "<section class='card panel'>기록을 불러오지 못했습니다.</section>";
    }
  }
}

async function appendOlderQuizPage() {
  if (quizNextOlderOffset == null) {
    return;
  }
  const list = $("quiz-history-list");
  const btn = $("btn-quiz-history-more");
  if (!list || !btn) {
    return;
  }
  btn.disabled = true;
  try {
    const off = quizNextOlderOffset;
    const r = await fetch(`/api/quiz/history?limit=${HISTORY_HEAD_LIMIT}&offset=${off}`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!r.ok) {
      throw new Error();
    }
    const d = await r.json();
    const attempts = Array.isArray(d.attempts) ? d.attempts : [];
    attempts.forEach(a => {
      list.appendChild(makeQuizAttemptCard(a, "tail"));
    });
    if (d.hasMore) {
      quizNextOlderOffset = off + attempts.length;
    } else {
      quizNextOlderOffset = null;
    }
    setQuizMoreButton();
  } catch (e) {
    /* ignore */
  } finally {
    btn.disabled = false;
  }
}

async function loadRagHistoryHead() {
  const list = $("rag-history-list");
  if (!list) {
    return;
  }
  try {
    const r = await fetch(`/api/rag/history?limit=${HISTORY_HEAD_LIMIT}&offset=0`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!r.ok) {
      throw new Error();
    }
    const d = await r.json();
    const jobs = Array.isArray(d.jobs) ? d.jobs : [];
    replaceRagHeadInDom(jobs);
    ragNextOlderOffset = d.hasMore ? jobs.length : null;
    setRagMoreButton();
  } catch (e) {
    if (!list.querySelector(".history-card")) {
      list.innerHTML = "<section class='card panel'>기록을 불러오지 못했습니다.</section>";
    }
  }
}

async function appendOlderRagPage() {
  if (ragNextOlderOffset == null) {
    return;
  }
  const list = $("rag-history-list");
  const btn = $("btn-rag-history-more");
  if (!list || !btn) {
    return;
  }
  btn.disabled = true;
  try {
    const off = ragNextOlderOffset;
    const r = await fetch(`/api/rag/history?limit=${HISTORY_HEAD_LIMIT}&offset=${off}`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!r.ok) {
      throw new Error();
    }
    const d = await r.json();
    const jobs = Array.isArray(d.jobs) ? d.jobs : [];
    jobs.forEach(j => {
      list.appendChild(makeRagJobCard(j, "tail"));
    });
    if (d.hasMore) {
      ragNextOlderOffset = off + jobs.length;
    } else {
      ragNextOlderOffset = null;
    }
    setRagMoreButton();
  } catch (e) {
    /* ignore */
  } finally {
    btn.disabled = false;
  }
}

function startHistoryLiveRefresh() {
  setInterval(async () => {
    if (document.visibilityState === "hidden") {
      return;
    }
    const y = window.scrollY;
    await Promise.all([loadQuizHistoryHead(), loadRagHistoryHead()]);
    window.scrollTo(0, y);
  }, 7000);
}

async function init() {
  const me = await loadMe();
  if (!me) {
    return;
  }
  $("btn-logout").onclick = doLogout;
  const qMore = $("btn-quiz-history-more");
  const rMore = $("btn-rag-history-more");
  if (qMore) {
    qMore.onclick = () => {
      void appendOlderQuizPage();
    };
  }
  if (rMore) {
    rMore.onclick = () => {
      void appendOlderRagPage();
    };
  }
  await Promise.all([loadQuizHistoryHead(), loadRagHistoryHead()]);
  startHistoryLiveRefresh();
}

init();
