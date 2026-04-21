const ST = {
  user: null,
  qs: [],
  ans: [],
  cur: 0,
  sel: null,
  startedAt: null,
  timerId: null,
  savedAttemptId: null,
  attemptId: null,
  batchExplainRunning: false,
  quizId: null,
  questionId: null
};
const $ = id => document.getElementById(id);

/** HTML/캐시에 (디버그) 등이 붙어 있어도 배포 라벨로 통일 */
function normalizeQuizExplainButtonLabels() {
  const cur = $("btn-explain-current");
  if (cur) {
    cur.textContent = "이 문제 AI 해설보기";
  }
  const single = $("btn-explain-single");
  if (single) {
    single.textContent = "AI해설 보기";
  }
  const batch = $("btn-batch-wrong-explain");
  if (batch && !ST.batchExplainRunning) {
    batch.textContent = "틀린 문제 전체 해설 신청";
  }
}

const RAG_POLL_MS = 2500;
const RAG_POLL_MAX = 140;

function renderInlineExplainLoading() {
  return `
    <div class="answer-explain-loading">
      <div class="spin spin-sm" aria-hidden="true"></div>
      <div>
        <div class="answer-explain-loading-title">강사님이 해설을 준비 중이에요…</div>
        <div class="muted" style="font-size:12px;margin-top:4px;line-height:1.45;">(예상 시간 약 30초) 잠시만 기다려 주세요</div>
      </div>
    </div>`;
}

function tryNotifyBatchExplainDone(wrongCount) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return;
    }
    new Notification("Passio", {
      body: `틀린 ${wrongCount}문항 해설 요청을 서버에 접수했어요. 히스토리에서 진행 상황을 확인할 수 있어요.`
    });
  } catch (_) {
    /* ignore */
  }
}

async function fetchRagJob(jobId) {
  const r = await fetch(`/api/rag/jobs/${encodeURIComponent(String(jobId))}`, {
    credentials: "same-origin",
    cache: "no-store"
  });
  let d = {};
  try {
    d = await r.json();
  } catch {
    d = {};
  }
  if (!r.ok) {
    throw new Error(d.message || d.detail || "작업 상태를 불러오지 못했습니다.");
  }
  return d.job || {};
}

async function waitForRagJobCompletion(jobId) {
  for (let n = 0; n < RAG_POLL_MAX; n += 1) {
    const job = await fetchRagJob(jobId);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await new Promise(res => setTimeout(res, RAG_POLL_MS));
  }
  throw new Error("해설 생성이 제한 시간 안에 끝나지 않았습니다. 히스토리에서 확인해 주세요.");
}

function buildExplainPostBody(index) {
  const q = ST.qs[index];
  const selectedIndex = userChoiceIndexForExplain(index);
  const answerText = String(q.options?.[q.answer] || "").trim();
  const wrongChoice =
    Number.isInteger(selectedIndex) && selectedIndex !== q.answer
      ? String(q.options?.[selectedIndex] || "").trim()
      : "";
  const payload = {
    question: String(q.question || "").trim(),
    options: Array.isArray(q.options) ? q.options.map(opt => String(opt || "").trim()) : [],
    wrongChoice,
    answerChoice: answerText,
    rebuild_db: false
  };
  const attemptId = ST.attemptId != null ? Number(ST.attemptId) : null;
  if (Number.isInteger(attemptId) && attemptId > 0) {
    payload.attemptId = attemptId;
    payload.answerIndex = index;
  }
  return payload;
}

function quizDetailHrefForJob(jobId, answerIndex) {
  const j = encodeURIComponent(String(jobId));
  const a = ST.attemptId != null ? encodeURIComponent(String(ST.attemptId)) : "";
  let path = a
    ? `/pages/quiz-attempt.html?id=${a}&ragJobId=${j}`
    : `/pages/quiz-attempt.html?ragJobId=${j}`;
  if (Number.isInteger(answerIndex) && answerIndex >= 0) {
    path += `&slide=${encodeURIComponent(String(answerIndex))}`;
  }
  return path;
}

function createQuizId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `quiz-${t}-${r}`;
}

function readQuizIdFromUrl() {
  const params = new URLSearchParams(location.search);
  const id = String(params.get("quizId") || "").trim();
  return id || null;
}

function readQuestionIdFromUrl() {
  const params = new URLSearchParams(location.search);
  const value = Number(params.get("questionId"));
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function replaceQuizLocationSearch(nextParams) {
  const url = new URL(location.href);
  url.search = "";
  nextParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  window.history.replaceState(null, "", url.pathname + url.search);
}

function setQuizParamsInUrl(quizId, questionId = null) {
  const params = new URLSearchParams();
  params.set("quizId", quizId);
  if (Number.isInteger(questionId) && questionId > 0) {
    params.set("questionId", String(questionId));
  }
  replaceQuizLocationSearch(params);
}

function subjectIcon(subject) {
  const s = String(subject || "");
  if (s.includes("TCP/IP")) return "🌐";
  if (s.includes("네트워크 일반")) return "🧭";
  if (s.includes("NOS")) return "🖥️";
  if (s.includes("운용기기")) return "🛠️";
  return "📘";
}

function buildAnswerResultCard(q, i) {
  const isOk = ST.ans[i] === q.answer;
  const selectedIndex = Number.isInteger(ST.ans[i]) ? ST.ans[i] : null;

  const el = document.createElement("div");
  el.className = `card answer-item ${isOk ? "ok" : "ng"}`;

  const subj = document.createElement("div");
  subj.className = "answer-subject";
  subj.textContent = `${subjectIcon(q.subject)} ${q.subject}`;

  const qText = document.createElement("div");
  qText.className = "answer-q";
  qText.textContent = `${i + 1}. ${q.question}`;

  const options = document.createElement("div");
  options.className = "result-options";

  q.options.forEach((opt, idx) => {
    const optionEl = document.createElement("div");
    optionEl.className = "result-option";

    if (idx === q.answer) {
      optionEl.classList.add("correct");
    }
    if (selectedIndex === idx) {
      optionEl.classList.add("selected");
    }
    if (selectedIndex === idx && idx !== q.answer) {
      optionEl.classList.add("wrong");
    }

    const badge = document.createElement("span");
    badge.className = "result-option-tag";
    badge.textContent = ["A", "B", "C", "D"][idx] || String(idx + 1);

    const text = document.createElement("span");
    text.className = "result-option-text";
    text.textContent = opt;

    optionEl.appendChild(badge);
    optionEl.appendChild(text);

    if (idx === q.answer || selectedIndex === idx) {
      const state = document.createElement("span");
      state.className = "result-option-state";
      if (idx === q.answer && selectedIndex === idx) {
        state.textContent = "정답";
      } else if (idx === q.answer) {
        state.textContent = "정답";
      } else if (selectedIndex === idx) {
        state.textContent = "내 선택";
      }
      optionEl.appendChild(state);
    }

    options.appendChild(optionEl);
  });

  el.appendChild(subj);
  el.appendChild(qText);
  el.appendChild(options);

  el.dataset.qIndex = String(i);

  /* 여러 문항 세트에서만 카드마다 온디맨드 행 — 1문제(문제은행 등)는 상단 버튼만 */
  if (ST.qs.length > 1) {
    const explainRow = document.createElement("div");
    explainRow.className = "answer-explain-row";

    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.cssText = "font-size:12px;margin-bottom:6px;line-height:1.45;";
    hint.textContent = "온디맨드: 이 문항만 해설 받기 (약 30초) →";

    const actions = document.createElement("div");
    actions.className = "answer-explain-actions";

    const explainBtn = document.createElement("button");
    explainBtn.type = "button";
    explainBtn.className = "btn btn-navy btn-sm answer-explain-btn";
    explainBtn.textContent = "AI 1타 강사 해설 보기";

    const panel = document.createElement("div");
    panel.className = "answer-explain-panel";

    explainBtn.onclick = async () => {
      if (ST.batchExplainRunning) {
        return;
      }
      await runInlineExplainForQuestionIndex(i, panel, explainBtn);
    };

    actions.appendChild(explainBtn);
    explainRow.appendChild(hint);
    explainRow.appendChild(actions);
    explainRow.appendChild(panel);
    el.appendChild(explainRow);
  }

  return el;
}

function showResultScreen() {
  $("screen-quiz").style.display = "none";
  $("screen-result").style.display = "block";
  window.scrollTo(0, 0);
}

function setUserBadges(name) {
  const full = String(name || "학습자").trim();

  ["ava-quiz", "ava-result"].forEach(id => {
    const el = $(id);
    if (el) {
      el.textContent = full;
      el.title = full;
    }
  });
}

function setTimerText() {
  if (!ST.startedAt) return;
  const sec = Math.floor((Date.now() - ST.startedAt) / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  $("quiz-time").textContent = `${m}:${s}`;
}

function bindHotkeys() {
  document.addEventListener("keydown", e => {
    if ($("screen-quiz").style.display !== "block") return;

    if (e.key === "Escape") {
      location.href = "/pages/dashboard.html";
      return;
    }

    if (e.key >= "1" && e.key <= "4") {
      const idx = Number(e.key) - 1;
      const btn = document.querySelector(`button[data-opt='${idx}']`);
      if (btn) btn.click();
    }

    if (e.key === "Enter" && !$("btn-next").disabled) {
      $("btn-next").click();
    }
  });
}

async function loadMe() {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!r.ok) {
      location.href = "/pages/login.html";
      return;
    }

    const d = await r.json();
    ST.user = d.user?.name || d.user?.username || "학습자";
    setUserBadges(ST.user);
  } catch (e) {
    location.href = "/pages/login.html";
  }
}

async function startQuiz() {
  ST.qs = [];
  ST.ans = [];
  ST.cur = 0;
  ST.sel = null;
  ST.startedAt = Date.now();
  ST.savedAttemptId = null;
  ST.attemptId = null;
  ST.batchExplainRunning = false;
  showExplainMessage("", "");

  if (ST.timerId) clearInterval(ST.timerId);
  ST.timerId = setInterval(setTimerText, 1000);
  setTimerText();

  $("quiz-loading").style.display = "block";
  $("quiz-content").style.display = "none";

  try {
    const endpoint = ST.questionId
      ? `/api/quiz/questions?questionId=${encodeURIComponent(String(ST.questionId))}`
      : "/api/quiz/questions";
    const r = await fetch(endpoint, { credentials: "same-origin" });
    if (!r.ok) throw new Error("문제 호출 실패");

    const d = await r.json();
    ST.qs = d.questions || [];
    if (!ST.qs.length) throw new Error("문제가 없습니다");

    renderQuestion(0);
    $("quiz-loading").style.display = "none";
    $("quiz-content").style.display = "block";
  } catch (e) {
    $("quiz-loading").innerHTML = `<p style='color:var(--red)'>문제를 불러오지 못했습니다: ${e.message}</p>`;
  }
}

async function saveAttemptHistory(totalQuestions, correctCount, durationSec) {
  if (ST.savedAttemptId) {
    return;
  }

  const saveMsg = $("save-msg");
  if (saveMsg) {
    saveMsg.textContent = "기록 저장 중...";
  }

  const answers = ST.qs.map((q, i) => ({
    questionId: q.id,
    subject: q.subject,
    questionText: q.question,
    selectedIndex: ST.ans[i] ?? null,
    correctIndex: q.answer
  }));

  try {
    const r = await fetch("/api/quiz/attempts", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        quizId: ST.quizId,
        durationSec,
        answers
      })
    });

    if (!r.ok) {
      throw new Error("저장 실패");
    }

    const d = await r.json();
    ST.savedAttemptId = d.attemptId || true;
    // 퀴즈 시도 저장 후 attemptId를 전역에 보관 (AI 해설 연동용)
    if (d.attemptId) {
      ST.attemptId = d.attemptId;
    }

    if (saveMsg) {
      saveMsg.textContent = "기록이 저장되었습니다. 히스토리에서 확인할 수 있어요.";
    }
  } catch (e) {
    if (saveMsg) {
      saveMsg.textContent = "기록 저장에 실패했습니다. 다시 시도해주세요.";
    }
  }
}

function showExplainMessage(type, text) {
  const className = type ? `msg ${type}` : "msg";
  for (const id of ["explain-msg", "explain-msg-current"]) {
    const msg = $(id);
    if (!msg) {
      continue;
    }
    msg.className = className;
    msg.textContent = text;
  }
}

function userChoiceIndexForExplain(index) {
  if (Number.isInteger(ST.ans[index])) {
    return ST.ans[index];
  }
  if (index === ST.cur && Number.isInteger(ST.sel)) {
    return ST.sel;
  }
  return null;
}

/** 한 문항 = 한 번의 POST (body에 여러 문항을 넣지 않음) */
async function postRagExplainJobForIndex(index) {
  const payload = buildExplainPostBody(index);
  const r = await fetch("/api/rag2/jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  let d = {};
  try {
    d = await r.json();
  } catch {
    d = {};
  }
  if (!r.ok) {
    throw new Error(d.message || d.detail || "해설 작업을 시작하지 못했습니다.");
  }
  const jobId = d.jobId != null ? d.jobId : d.id;
  return jobId;
}

async function completeExplainPanelFromJobId(jobId, panel, answerIndex) {
  const job = await waitForRagJobCompletion(jobId);
  if (job.status === "failed") {
    throw new Error(job.errorMessage || "AI 해설 생성에 실패했습니다.");
  }
  const href = quizDetailHrefForJob(job.id, answerIndex);
  panel.innerHTML = `<a class="btn btn-navy btn-sm" href="${href}">해설 보기</a>`;
  panel.dataset.state = "done";
}

function renderExplainPanelErrorWithRetry(panel, btn, index, err) {
  panel.dataset.state = "error";
  const msg = err && err.message ? err.message : String(err);
  panel.innerHTML = "";
  const errDiv = document.createElement("div");
  errDiv.className = "msg err";
  errDiv.style.margin = "0";
  errDiv.textContent = msg;
  panel.appendChild(errDiv);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn btn-out btn-sm answer-explain-retry";
  retry.style.marginTop = "8px";
  retry.textContent = "다시 시도";
  retry.onclick = () => {
    panel.innerHTML = "";
    panel.dataset.state = "";
    void runInlineExplainForQuestionIndex(index, panel, btn);
  };
  panel.appendChild(retry);
}

async function runInlineExplainForQuestionIndex(index, panel, btn) {
  if (!ST.qs[index] || !panel) {
    return;
  }
  if (panel.dataset.state === "done") {
    return;
  }
  if (panel.dataset.state === "loading") {
    return;
  }

  const prevText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
  }
  panel.dataset.state = "loading";
  panel.innerHTML = renderInlineExplainLoading();

  try {
    const jobId = await postRagExplainJobForIndex(index);
    await completeExplainPanelFromJobId(jobId, panel, index);
  } catch (err) {
    renderExplainPanelErrorWithRetry(panel, btn, index, err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || "AI 1타 강사 해설 보기";
    }
  }
}

async function runBatchWrongExplains(indices) {
  if (!indices.length || ST.batchExplainRunning) {
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (_) {
      /* ignore */
    }
  }
  const ok = window.confirm(
    "틀린 문항마다 해설 요청을 **한 건씩** 서버에 올립니다.\n\n" +
      "• 요청은 **곧바로 전부 접수**되고, **생성은 서버가 순서대로** 처리합니다.\n" +
      "• 이 화면을 닫아도 됩니다. **히스토리 → AI 해설** 또는 나중에 이 결과 페이지를 새로고침해 확인하세요.\n\n" +
      "진행할까요?"
  );
  if (!ok) {
    return;
  }

  const banner = $("batch-explain-banner");
  const text = $("batch-explain-text");
  const batchBtn = $("btn-batch-wrong-explain");

  ST.batchExplainRunning = true;
  if (batchBtn) {
    batchBtn.disabled = true;
    batchBtn.textContent = "요청 접수 중…";
  }
  if (banner) {
    banner.style.display = "block";
    banner.classList.add("is-active");
  }

  const rows = [];

  try {
    for (let k = 0; k < indices.length; k += 1) {
      const i = indices[k];
      const card = document.querySelector(`.answer-item[data-q-index="${i}"]`);
      const panel = card && card.querySelector(".answer-explain-panel");
      const explainBtn = card && card.querySelector(".answer-explain-btn");
      if (!panel || !explainBtn) {
        continue;
      }
      explainBtn.disabled = true;
      if (text) {
        text.textContent = `요청 접수: ${k + 1}/${indices.length} — 문제 ${i + 1}번`;
      }
      panel.dataset.state = "posting";
      panel.innerHTML =
        "<div class=\"muted\" style=\"font-size:12px;line-height:1.5;\">서버에 요청 전송 중…</div>";
      try {
        const jobId = await postRagExplainJobForIndex(i);
        rows.push({ i, jobId, panel, explainBtn });
        panel.dataset.state = "queued";
        panel.innerHTML =
          "<div class=\"muted\" style=\"font-size:12px;line-height:1.5;\">접수됨 · 대기열에서 해설 생성 중</div>";
      } catch (err) {
        renderExplainPanelErrorWithRetry(panel, explainBtn, i, err);
      }
    }

    if (!rows.length) {
      if (text) {
        text.textContent = "접수된 요청이 없습니다.";
      }
    } else {
      if (text) {
        text.textContent =
          `요청 ${rows.length}건을 서버에 모두 접수했어요. 창을 닫아도 서버에서 순서대로 생성합니다. 히스토리 → AI 해설에서 확인하거나, 나중에 이 화면을 새로고침해 주세요.`;
      }
      if (batchBtn) {
        batchBtn.textContent = "접수 완료";
      }

      rows.forEach(({ i, panel, explainBtn }) => {
        if (!panel || panel.dataset.state === "error") {
          return;
        }
        panel.dataset.state = "queued";
        panel.innerHTML =
          "<div class=\"muted\" style=\"font-size:12px;line-height:1.55;\">서버에서 생성 중 — " +
          "<a href=\"/pages/history.html\">히스토리(AI 해설)</a>에서 확인하거나, 잠시 후 이 페이지를 새로고침해 보세요.</div>";
        if (explainBtn) {
          explainBtn.disabled = false;
        }
      });

      tryNotifyBatchExplainDone(rows.length);
      if (document.hidden) {
        const prevTitle = document.title;
        document.title = "✓ 해설 신청 완료 · Passio";
        setTimeout(() => {
          document.title = prevTitle;
        }, 4500);
      }
    }
  } catch (e) {
    if (text) {
      text.textContent = e && e.message ? e.message : "일부 처리에 문제가 있었습니다.";
    }
  }

  indices.forEach(i => {
    const card = document.querySelector(`.answer-item[data-q-index="${i}"]`);
    const explainBtn = card && card.querySelector(".answer-explain-btn");
    if (explainBtn) {
      explainBtn.disabled = false;
    }
  });

  ST.batchExplainRunning = false;
  if (batchBtn) {
    batchBtn.disabled = false;
    batchBtn.textContent = "틀린 문제 전체 해설 신청";
  }
  if (banner) {
    banner.classList.remove("is-active");
  }
}

async function requestAiExplainForIndex(index, buttonEl) {
  const q = ST.qs[index];
  if (!q) {
    showExplainMessage("err", "해설할 문제 정보를 찾지 못했습니다.");
    return;
  }

  if (buttonEl) {
    buttonEl.disabled = true;
  }
  showExplainMessage("", "AI 해설 작업을 생성하는 중...");

  try {
    const payload = buildExplainPostBody(index);
    const attemptId = ST.attemptId || null;
    const r = await fetch("/api/rag2/jobs", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let d = {};
    try {
      d = await r.json();
    } catch {
      d = {};
    }
    if (!r.ok) {
      showExplainMessage("err", d.message || d.detail || "AI 해설 요청 생성에 실패했습니다.");
      return;
    }

    const jobId = d.jobId != null ? d.jobId : d.id;
    let nextUrl = `/pages/ai-loading.html?jobId=${encodeURIComponent(String(jobId))}`;
    if (attemptId) {
      nextUrl += `&fromQuiz=${encodeURIComponent(String(attemptId))}`;
    }
    location.href = nextUrl;
  } catch (e) {
    showExplainMessage("err", "네트워크 오류로 해설 요청을 생성하지 못했습니다.");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
    }
  }
}

function bindCurrentQuestionExplainButton() {
  const currentExplainBtn = $("btn-explain-current");
  if (!currentExplainBtn) {
    return;
  }

  currentExplainBtn.style.display = "inline-flex";
  currentExplainBtn.onclick = () => requestAiExplainForIndex(ST.cur, currentExplainBtn);
}

function renderQuestion(i) {
  const curMsg = $("explain-msg-current");
  if (curMsg) {
    curMsg.className = "msg";
    curMsg.textContent = "";
  }

  const q = ST.qs[i];
  const total = ST.qs.length;

  const screenQuiz = $("screen-quiz");
  if (screenQuiz) {
    screenQuiz.classList.toggle("quiz-taking--single", total === 1);
  }

  $("q-current").textContent = i + 1;
  $("q-total").textContent = total;
  $("q-no").textContent = `문제 ${i + 1} · ID ${q.id}`;
  $("q-subject").textContent = `${subjectIcon(q.subject)} 네트워크 관리사 2급 · ${q.subject}`;
  $("q-text").textContent = q.question;
  $("q-progress").style.width = `${((i + 1) / total) * 100}%`;

  const wrap = $("q-options");
  wrap.innerHTML = "";

  q.options.forEach((opt, idx) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.dataset.opt = String(idx);
    b.innerHTML = `<span class='opt-tag'>${["A", "B", "C", "D"][idx]}</span>${opt}`;
    b.onclick = () => {
      wrap.querySelectorAll(".opt").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      ST.sel = idx;
      $("btn-next").disabled = false;
    };
    wrap.appendChild(b);
  });

  ST.sel = null;
  $("btn-next").disabled = true;
  $("btn-next").textContent = i === total - 1 ? "결과 보기" : "다음 문제";
  $("remain-count").textContent = total - (i + 1);
  bindCurrentQuestionExplainButton();
}

function goNext() {
  ST.ans.push(ST.sel);

  if (ST.cur < ST.qs.length - 1) {
    ST.cur += 1;
    renderQuestion(ST.cur);
  } else {
    void showResult();
  }
}

async function showResult() {
  if (ST.timerId) clearInterval(ST.timerId);
  showResultScreen();

  const total = ST.qs.length;
  let ok = 0;
  ST.qs.forEach((q, i) => {
    if (ST.ans[i] === q.answer) ok += 1;
  });
  const wrongCount = total - ok;

  $("score").textContent = total === 1
    ? (wrongCount === 0 ? "정답" : "오답")
    : (wrongCount === 0 ? "전체 정답" : `오답 ${wrongCount}개`);
  $("score-msg").textContent = total === 1
    ? (wrongCount === 0 ? "정확하게 맞혔어요." : "틀린 선지를 다시 확인해봐요.")
    : wrongCount === 0
      ? "모든 문제를 맞혔습니다."
      : "틀린 문제 중심으로 다시 보면 효율적입니다.";

  $("score-ok").textContent = `정답 ${ok}개`;
  $("score-ng").textContent = `오답 ${wrongCount}개`;

  const spent = Math.floor((Date.now() - ST.startedAt) / 1000);
  const m = String(Math.floor(spent / 60)).padStart(2, "0");
  const s = String(spent % 60).padStart(2, "0");
  $("spent-time").textContent = `${m}:${s}`;

  const uxHint = $("result-ux-hint");
  if (uxHint) {
    uxHint.style.display = total > 1 ? "block" : "none";
  }

  const screenResult = $("screen-result");
  if (screenResult) {
    screenResult.classList.toggle("quiz-result--single", total === 1);
  }

  await saveAttemptHistory(total, ok, spent);

  const list = $("result-list");
  list.innerHTML = "";
  showExplainMessage("", "");

  const banner = $("batch-explain-banner");
  const batchText = $("batch-explain-text");
  if (banner) {
    banner.style.display = "none";
  }
  if (batchText) {
    batchText.textContent = "";
  }

  ST.qs.forEach((q, i) => {
    list.appendChild(buildAnswerResultCard(q, i));
  });

  const wrongIndices = ST.qs
    .map((q, i) => (ST.ans[i] !== q.answer ? i : null))
    .filter(v => v !== null);

  const batchBtn = $("btn-batch-wrong-explain");
  if (batchBtn) {
    batchBtn.onclick = null;
    if (wrongIndices.length > 0 && total > 1) {
      batchBtn.style.display = "inline-flex";
      batchBtn.disabled = false;
      batchBtn.textContent = "틀린 문제 전체 해설 신청";
      batchBtn.onclick = () => {
        void runBatchWrongExplains(wrongIndices);
      };
    } else {
      batchBtn.style.display = "none";
    }
  }

  const singleExplainBtn = $("btn-explain-single");
  const singleExplainWrap = $("result-single-explain-wrap");
  if (singleExplainWrap) {
    singleExplainWrap.style.display = total === 1 ? "inline-flex" : "none";
  }
  if (singleExplainBtn) {
    if (total === 1) {
      singleExplainBtn.style.display = "inline-flex";
      singleExplainBtn.onclick = e => {
        e.preventDefault();
        void requestAiExplainForIndex(0, singleExplainBtn);
      };
    } else {
      singleExplainBtn.style.display = "none";
      singleExplainBtn.onclick = null;
    }
  }
}

function init() {
  normalizeQuizExplainButtonLabels();

  const questionId = readQuestionIdFromUrl();
  const quizId = questionId ? null : (readQuizIdFromUrl() || createQuizId());

  ST.quizId = quizId;
  ST.questionId = questionId;

  if (quizId) {
    sessionStorage.setItem("activeQuizId", quizId);
    setQuizParamsInUrl(quizId, null);
  } else {
    const params = new URLSearchParams();
    params.set("questionId", String(questionId));
    replaceQuizLocationSearch(params);
  }

  bindHotkeys();
  loadMe();
  startQuiz();
  bindCurrentQuestionExplainButton();

  $("btn-next").onclick = goNext;
  $("btn-exit").onclick = () => {
    location.href = "/pages/dashboard.html";
  };
  $("btn-retry").onclick = () => {
    if (ST.questionId) {
      $("screen-result").style.display = "none";
      $("screen-quiz").style.display = "block";
      startQuiz();
      return;
    }
    const nextQuizId = createQuizId();
    ST.quizId = nextQuizId;
    sessionStorage.setItem("activeQuizId", nextQuizId);
    setQuizParamsInUrl(nextQuizId, null);
    $("screen-result").style.display = "none";
    $("screen-quiz").style.display = "block";
    startQuiz();
  };
  $("btn-home").onclick = () => {
    location.href = "/pages/index.html";
  };
}

init();
