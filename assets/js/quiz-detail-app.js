const $ = id => document.getElementById(id);

/** pages/quiz-attempt.html 인라인 검사와 동일 값 유지 */
window.__PASSIO_QUIZ_DETAIL_APP__ = "app-20260420pdfWrongOnly";

let detailBatchRunning = false;
/** @type {ReturnType<typeof setInterval> | null} */
let detailLivePoll = null;

function escapeHtml(value) {
  return window.QuizAiBlocks ? window.QuizAiBlocks.escapeHtml(value) : String(value || "");
}

function getAttemptId() {
  const params = new URLSearchParams(location.search);
  return params.get("id");
}

function readInitialSlide(total) {
  const params = new URLSearchParams(location.search);
  const s = Number(params.get("slide"));
  if (Number.isInteger(s) && s >= 0 && s < total) {
    return s;
  }
  const n = Number(params.get("n"));
  if (Number.isInteger(n) && n >= 1 && n <= total) {
    return n - 1;
  }
  return 0;
}

function updateSlideInUrl() {
  if (!detailAttempt || !detailAttempt.answers) {
    return;
  }
  const url = new URL(location.href);
  if (detailAttempt.answers.length > 1) {
    url.searchParams.set("slide", String(slideIndex));
  } else {
    url.searchParams.delete("slide");
  }
  window.history.replaceState(null, "", url.pathname + url.search);
}

let detailAttempt = null;
let slideIndex = 0;

function isAnswerWrong(a) {
  if (a && a.isCorrect === true) {
    return false;
  }
  if (a && a.isCorrect === false) {
    return true;
  }
  const si = a && a.selectedIndex;
  const ci = a && a.correctIndex;
  if (Number.isInteger(si) && Number.isInteger(ci)) {
    return si !== ci;
  }
  return false;
}

function getWrongAnswerIndices() {
  if (!detailAttempt || !Array.isArray(detailAttempt.answers)) {
    return [];
  }
  return detailAttempt.answers.map((a, i) => (isAnswerWrong(a) ? i : null)).filter(i => i !== null);
}

function answerHasAiExplain(a) {
  if (!window.QuizAiBlocks || typeof window.QuizAiBlocks.buildQuizAiExplainFromAnswer !== "function") {
    return false;
  }
  const html = window.QuizAiBlocks.buildQuizAiExplainFromAnswer(a);
  return Boolean(html && String(html).trim());
}

function allWrongAnswersHaveAiPlainText(att) {
  const ans = Array.isArray(att && att.answers) ? att.answers : [];
  const wrong = ans.filter(a => a && a.isCorrect !== true);
  if (!wrong.length) {
    return false;
  }
  return wrong.every(a => String(a && a.aiExplanation ? a.aiExplanation : "").trim().length > 0);
}

function updatePdfExportUi() {
  const btn = $("btn-quiz-pdf-export");
  const hint = $("quiz-pdf-hint");
  if (!btn || !hint || !detailAttempt) {
    return;
  }
  const id = detailAttempt.id;
  if (allWrongAnswersHaveAiPlainText(detailAttempt)) {
    btn.style.display = "inline-flex";
    hint.style.display = "none";
    btn.onclick = async e => {
      e.preventDefault();
      btn.setAttribute("aria-busy", "true");
      btn.disabled = true;
      try {
        const rr = await fetch(`/api/quiz/history/${encodeURIComponent(String(id))}/pdf`, {
          credentials: "same-origin",
          cache: "no-store"
        });
        if (!rr.ok) {
          let msg = "PDF를 만들지 못했습니다.";
          try {
            const j = await rr.json();
            msg = j.message || j.detail || msg;
          } catch (_) {
            /* ignore */
          }
          window.alert(msg);
          return;
        }
        const blob = await rr.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `passio-quiz-${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (_) {
        window.alert("네트워크 오류로 PDF를 받지 못했습니다.");
      } finally {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    };
  } else {
    btn.style.display = "none";
    hint.style.display = "inline";
    hint.textContent = "오답 문항의 AI 해설이 모두 붙으면, 한 파일로 내려받을 수 있습니다.";
    btn.onclick = null;
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
  }
}

function buildDetailExplainPayload(answerIndex) {
  const a = detailAttempt.answers[answerIndex];
  if (!a) {
    return null;
  }
  const opts = Array.isArray(a.options) ? a.options : [];
  const si = a.selectedIndex;
  const ci = a.correctIndex;
  const wrongChoice =
    Number.isInteger(si) && Number.isInteger(ci) && si !== ci && opts[si] ? String(opts[si]) : "";
  const answerChoice = Number.isInteger(ci) && opts[ci] ? String(opts[ci]) : "";
  return {
    question: String(a.questionText || "").trim(),
    options: opts.map(o => String(o || "").trim()),
    wrongChoice,
    answerChoice,
    attemptId: detailAttempt.id,
    answerIndex,
    rebuild_db: false
  };
}

async function postDetailRagJob(answerIndex) {
  const payload = buildDetailExplainPayload(answerIndex);
  if (!payload) {
    throw new Error("문항 데이터를 찾지 못했습니다.");
  }
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

function renderDetailBatchPicksHtml() {
  const answers = detailAttempt.answers;
  const wrongSet = new Set(getWrongAnswerIndices());
  return answers
    .map((a, i) => {
      const wrong = wrongSet.has(i);
      const hasAi = answerHasAiExplain(a);
      const hint = hasAi ? " <span class='muted'>(이미 해설)</span>" : "";
      const badge = wrong
        ? "<span class='q-tag wrong' style='margin-left:6px;vertical-align:middle;'>오답</span>"
        : "<span class='q-tag' style='margin-left:6px;vertical-align:middle;background:var(--grn-l);color:var(--grn);border:1px solid var(--grn-b);'>정답</span>";
      const checked = wrong ? "checked" : "";
      const dataWrong = wrong ? ' data-wrong="1"' : "";
      return `<label class="quiz-detail-batch-item"><input type="checkbox" class="quiz-detail-batch-cb" value="${i}"${dataWrong} ${checked} aria-label="문제 ${i + 1}"/>문제 ${i + 1}${badge}${hint}</label>`;
    })
    .join("");
}

function setDetailBatchControlsDisabled(disabled) {
  for (const id of [
    "btn-detail-batch-select-all",
    "btn-detail-batch-select-wrong",
    "btn-detail-batch-select-none",
    "btn-detail-batch-run",
    "btn-detail-batch-run-all-wrong"
  ]) {
    const el = $(id);
    if (el) {
      el.disabled = disabled;
    }
  }
}

function wireDetailBatchToolbar() {
  const wrap = $("quiz-detail-batch-wrap");
  const picks = $("quiz-detail-batch-picks");
  const wrongIndices = getWrongAnswerIndices();
  if (!wrap || !picks || !detailAttempt || !detailAttempt.answers || !detailAttempt.answers.length) {
    if (wrap) {
      wrap.style.display = "none";
    }
    return;
  }
  if (detailAttempt.answers.length < 2) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  picks.innerHTML = renderDetailBatchPicksHtml();

  const btnPickAll = $("btn-detail-batch-select-all");
  const btnWrongOnly = $("btn-detail-batch-select-wrong");
  const btnNone = $("btn-detail-batch-select-none");
  const btnRun = $("btn-detail-batch-run");
  const btnAllWrong = $("btn-detail-batch-run-all-wrong");

  if (btnPickAll) {
    btnPickAll.disabled = false;
    btnPickAll.onclick = () => {
      picks.querySelectorAll(".quiz-detail-batch-cb").forEach(cb => {
        cb.checked = true;
      });
    };
  }
  if (btnWrongOnly) {
    if (wrongIndices.length) {
      btnWrongOnly.disabled = false;
      btnWrongOnly.onclick = () => {
        picks.querySelectorAll(".quiz-detail-batch-cb").forEach(cb => {
          cb.checked = cb.getAttribute("data-wrong") === "1";
        });
      };
    } else {
      btnWrongOnly.disabled = true;
      btnWrongOnly.onclick = null;
    }
  }
  if (btnNone) {
    btnNone.disabled = false;
    btnNone.onclick = () => {
      picks.querySelectorAll(".quiz-detail-batch-cb").forEach(cb => {
        cb.checked = false;
      });
    };
  }
  if (btnRun) {
    btnRun.disabled = false;
    btnRun.onclick = () => {
      const checked = Array.from(picks.querySelectorAll(".quiz-detail-batch-cb:checked"))
        .map(cb => Number(cb.value))
        .filter(n => Number.isInteger(n) && n >= 0);
      checked.sort((x, y) => x - y);
      void runBatchDetailExplains(checked);
    };
  }
  if (btnAllWrong) {
    if (wrongIndices.length) {
      btnAllWrong.disabled = false;
      btnAllWrong.onclick = () => {
        const all = wrongIndices.slice().sort((x, y) => x - y);
        void runBatchDetailExplains(all);
      };
    } else {
      btnAllWrong.disabled = true;
      btnAllWrong.onclick = null;
    }
  }
}

async function runBatchDetailExplains(indices) {
  if (!indices.length || detailBatchRunning) {
    if (!indices.length) {
      window.alert("해설을 요청할 문항을 하나 이상 선택해 주세요.");
    }
    return;
  }
  const ok = window.confirm(
    "선택한 문항마다 해설 요청(POST)을 한 번씩 보냅니다.\n\n" +
      "요청은 **곧바로 모두 접수**되고, **생성은 서버가 순서대로** 처리합니다. 이 페이지를 닫아도 됩니다.\n" +
      "히스토리 → AI 해설에서 확인하거나, 나중에 이 페이지를 새로고침하세요.\n\n" +
      "진행할까요?"
  );
  if (!ok) {
    return;
  }

  detailBatchRunning = true;
  const banner = $("quiz-detail-batch-banner");
  const text = $("quiz-detail-batch-text");
  setDetailBatchControlsDisabled(true);
  if (banner) {
    banner.style.display = "block";
  }

  const rows = [];
  try {
    for (let k = 0; k < indices.length; k += 1) {
      const i = indices[k];
      if (text) {
        text.textContent = `요청 전송: ${k + 1}/${indices.length} — 문제 ${i + 1}`;
      }
      try {
        const jobId = await postDetailRagJob(i);
        rows.push({ i, jobId });
      } catch (err) {
        window.alert(`문제 ${i + 1}: ${err && err.message ? err.message : String(err)}`);
      }
    }

    if (text) {
      text.textContent = `요청 ${rows.length}건 접수 완료. 서버에서 순서대로 생성 중입니다. 히스토리(AI 해설)에서 확인하거나, 잠시 후 이 페이지를 새로고침하세요.`;
    }
  } catch (e) {
    if (text) {
      text.textContent = e && e.message ? e.message : "일부 처리에 문제가 있었습니다.";
    }
  } finally {
    detailBatchRunning = false;
    setDetailBatchControlsDisabled(false);
  }
}

function renderQuestionSlide(a, idx, total) {
  const correctIdx = Number(a.correctIndex);
  const selectedIdx = a.selectedIndex;
  const opts = Array.isArray(a.options) && a.options.length > 0 ? a.options : [];
  const explainHtml = window.QuizAiBlocks.buildQuizAiExplainFromAnswer(a);
  const hasAiExplain = Boolean(explainHtml && String(explainHtml).trim());
  const officialTrim = a.explanation && String(a.explanation).trim();
  const officialRow =
    hasAiExplain || !officialTrim
      ? ""
      : `<div class="quiz-q-official"><span class="muted">공식 해설: ${escapeHtml(officialTrim)}</span></div>`;
  const ctaBlock = !hasAiExplain
    ? `<div class="quiz-q-explain-cta">
        <button type="button" class="btn btn-navy" id="btn-explain">이 문항 AI 해설 받기</button>
        <p class="muted" style="margin:8px 0 0;font-size:12px;">위 버튼을 누르면 이 문항만 해설이 생성되고, 완료 후 이 페이지로 돌아옵니다.</p>
      </div>`
    : "";
  const aiBody = hasAiExplain
    ? explainHtml
    : `<p class="muted" style="margin:8px 0 0;">아직 이 문항에 대한 AI 해설이 없습니다.</p>${ctaBlock}`;
  const progressHtml = `<div class="quiz-q-label">문제 ${idx + 1} / ${total}</div>`;
  return `
    <div class="quiz-q-card quiz-q-card--slide">
      <div class="quiz-q-head">
        ${progressHtml}
        <div class="quiz-q-text">${escapeHtml(a.questionText || "")}</div>
      </div>
      <div class="quiz-q-options">
        ${opts.length
          ? opts
              .map((opt, i) => {
                let cls = "";
                let tag = "";
                if (i === correctIdx) {
                  cls = "correct";
                  tag = `<span class='q-tag'>정답</span>`;
                } else if (selectedIdx !== undefined && selectedIdx !== null && i === selectedIdx && !a.isCorrect) {
                  cls = "wrong";
                  tag = `<span class='q-tag wrong'>오답</span>`;
                }
                return `<div class='quiz-q-option ${cls}'>${i + 1}) ${escapeHtml(opt)}${tag}</div>`;
              })
              .join("")
          : `<div class='quiz-q-option' style='color:var(--t3);font-style:italic;'>선지 정보가 없습니다</div>`}
      </div>
      <div class="quiz-q-explain">
        ${officialRow}
        ${aiBody}
      </div>
    </div>`;
}

function syncPagerUi() {
  const total = detailAttempt && detailAttempt.answers ? detailAttempt.answers.length : 0;
  const prev = $("btn-quiz-prev");
  const next = $("btn-quiz-next");
  const label = $("quiz-slide-label");
  if (label) {
    label.textContent = "";
  }
  if (prev) {
    prev.disabled = slideIndex <= 0;
    prev.style.visibility = total > 1 ? "visible" : "hidden";
  }
  if (next) {
    next.disabled = slideIndex >= total - 1;
    next.style.visibility = total > 1 ? "visible" : "hidden";
  }
  const pager = $("quiz-detail-pager");
  if (pager) {
    pager.style.display = total > 1 ? "flex" : "none";
  }
}

function renderCurrentSlide() {
  const wrap = $("quiz-detail-slide");
  if (!wrap || !detailAttempt || !detailAttempt.answers) {
    return;
  }
  const total = detailAttempt.answers.length;
  const a = detailAttempt.answers[slideIndex];
  if (!a) {
    return;
  }
  wrap.innerHTML = renderQuestionSlide(a, slideIndex, total);
  syncPagerUi();
  updateSlideInUrl();
  updatePdfExportUi();

  const btn = $("btn-explain");
  const hasAi = Boolean(window.QuizAiBlocks.buildQuizAiExplainFromAnswer(a));
  if (btn) {
    btn.onclick = null;
    btn.removeAttribute("aria-busy");
    btn.style.pointerEvents = "";
  }
  if (btn && !hasAi) {
    btn.onclick = async e => {
      e.preventDefault();
      const prevText = btn.textContent;
      btn.setAttribute("aria-busy", "true");
      btn.style.pointerEvents = "none";
      btn.textContent = "해설 생성 중…";
      try {
        const payload = {
          question: a.questionText,
          options: a.options || [],
          wrongChoice:
            a.selectedIndex !== undefined &&
            a.selectedIndex !== null &&
            a.selectedIndex !== a.correctIndex &&
            a.options
              ? a.options[a.selectedIndex]
              : "",
          answerChoice: a.options && a.options[a.correctIndex] ? a.options[a.correctIndex] : "",
          attemptId: detailAttempt.id,
          answerIndex: slideIndex,
          rebuild_db: false
        };
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
          window.alert(d.message || d.detail || "AI 해설 요청 생성에 실패했습니다.");
          return;
        }
        const jobId = d.jobId != null ? d.jobId : d.id;
        const fromId = String(detailAttempt.id);
        const slideQ = encodeURIComponent(String(slideIndex));
        location.href = `/pages/ai-loading.html?jobId=${encodeURIComponent(String(jobId))}&fromQuiz=${encodeURIComponent(fromId)}&slide=${slideQ}`;
      } catch (err) {
        window.alert("네트워크 오류로 요청을 생성하지 못했습니다.");
      } finally {
        btn.textContent = prevText || "이 문항 AI 해설 받기";
        btn.removeAttribute("aria-busy");
        btn.style.pointerEvents = "";
      }
    };
  }
}

function summarizeAnswersForPoll(attempt) {
  if (!attempt?.answers?.length) {
    return "";
  }
  return attempt.answers
    .map(a => {
      const plen = a.aiRagPayload != null ? String(JSON.stringify(a.aiRagPayload)).length : 0;
      return `${plen}`;
    })
    .join("|");
}

function stopQuizDetailLiveRefresh() {
  if (detailLivePoll) {
    clearInterval(detailLivePoll);
    detailLivePoll = null;
  }
}

function startQuizDetailLiveRefresh(attemptId) {
  stopQuizDetailLiveRefresh();
  let lastSnap = summarizeAnswersForPoll(detailAttempt);
  detailLivePoll = setInterval(async () => {
    if (document.visibilityState === "hidden") {
      return;
    }
    try {
      const r = await fetch(`/api/quiz/history/${encodeURIComponent(String(attemptId))}`, {
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!r.ok) {
        return;
      }
      const d = await r.json();
      const att = d.attempt;
      if (!att?.answers) {
        return;
      }
      const snap = summarizeAnswersForPoll(att);
      if (snap === lastSnap) {
        return;
      }
      lastSnap = snap;
      const n = att.answers.length;
      if (slideIndex >= n) {
        slideIndex = Math.max(0, n - 1);
      }
      detailAttempt = att;
      renderCurrentSlide();
      wireDetailBatchToolbar();
      updatePdfExportUi();
    } catch (_) {
      /* ignore */
    }
  }, 4000);
}

window.addEventListener("pagehide", () => {
  stopQuizDetailLiveRefresh();
});

function wirePager() {
  const prev = $("btn-quiz-prev");
  const next = $("btn-quiz-next");
  if (prev) {
    prev.onclick = () => {
      if (slideIndex > 0) {
        slideIndex -= 1;
        renderCurrentSlide();
        window.scrollTo(0, 0);
      }
    };
  }
  if (next) {
    next.onclick = () => {
      const n = detailAttempt && detailAttempt.answers ? detailAttempt.answers.length : 0;
      if (slideIndex < n - 1) {
        slideIndex += 1;
        renderCurrentSlide();
        window.scrollTo(0, 0);
      }
    };
  }
}

async function loadQuizDetail() {
  const id = getAttemptId();
  const main = $("quiz-detail-main");
  stopQuizDetailLiveRefresh();
  if (!main) {
    return;
  }
  if (!window.QuizAiBlocks) {
    main.innerHTML = "<section class='card panel'>해설 UI 모듈을 불러오지 못했습니다.</section>";
    return;
  }
  if (!id) {
    main.innerHTML = "<section class='card panel'>잘못된 접근입니다.</section>";
    return;
  }

  const params = new URLSearchParams(location.search);
  const ragJobId = params.get("ragJobId");
  if (ragJobId) {
    setTimeout(() => {
      const url = new URL(location.href);
      url.searchParams.delete("ragJobId");
      window.location.replace(url.toString());
    }, 1000);
  }

  try {
    const r = await fetch(`/api/quiz/history/${id}`, { credentials: "same-origin" });
    if (!r.ok) throw new Error();
    const d = await r.json();
    const attempt = d.attempt;
    if (!attempt) throw new Error();

    detailAttempt = attempt;
    const answers = Array.isArray(attempt.answers) ? attempt.answers : [];
    slideIndex = readInitialSlide(answers.length);

    const staticBanner = $("quiz-detail-static-banner");
    if (staticBanner) {
      staticBanner.remove();
    }

    main.innerHTML = `
      <section class="card quiz-detail-card quiz-detail-session">
        <div class="quiz-detail-head">
          <h2>세션 #${attempt.id}</h2>
          <div class="muted" style="font-size:13px;">${escapeHtml(attempt.createdAt)}</div>
          <div class="quiz-detail-pdf-row" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <button type="button" class="btn btn-navy btn-sm" id="btn-quiz-pdf-export" style="display:none;">전체 PDF (문항+AI해설)</button>
            <span id="quiz-pdf-hint" class="muted" style="font-size:12px;display:none;">모든 문항에 AI 해설이 붙으면, 한 파일로 내려받을 수 있습니다.</span>
          </div>
        </div>
        <div class="quiz-detail-meta">
          <span class="dash-chip">총 ${attempt.totalQuestions}문제</span>
          <span class="dash-chip ok">정답 ${attempt.correctCount}</span>
          <span class="dash-chip ng">오답 ${attempt.totalQuestions - attempt.correctCount}</span>
        </div>
      </section>
      <section id="quiz-detail-batch-wrap" class="card panel quiz-detail-batch-wrap result-explain-toolbar" style="display:none;">
        <h3 style="margin:0 0 8px;font-size:1rem;">여러 문항 · AI 해설 묶음 요청</h3>
        <p class="muted" style="margin:0 0 12px;font-size:13px;line-height:1.65;">
          기본으로 <strong>오답만 체크</strong>되어 있습니다. 선택한 문항만 요청하거나, 오답 전체를 한 번에 요청할 수 있습니다.
        </p>
        <div id="quiz-detail-batch-picks" class="quiz-detail-batch-picks" aria-label="문항 선택"></div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center;">
          <button type="button" class="btn btn-out btn-sm" id="btn-detail-batch-select-all">전체 문항 선택</button>
          <button type="button" class="btn btn-out btn-sm" id="btn-detail-batch-select-wrong">오답만 체크</button>
          <button type="button" class="btn btn-out btn-sm" id="btn-detail-batch-select-none">선택 모두 해제</button>
          <button type="button" class="btn btn-navy btn-sm" id="btn-detail-batch-run">선택한 문항만 해설 요청</button>
          <button type="button" class="btn btn-navy btn-sm" id="btn-detail-batch-run-all-wrong">틀린 문항 전부 해설 요청</button>
        </div>
        <div id="quiz-detail-batch-banner" class="card panel batch-explain-banner" style="display:none;margin-top:12px;padding:12px 14px;">
          <p id="quiz-detail-batch-text" class="muted" style="margin:0;font-size:13px;line-height:1.5;"></p>
        </div>
      </section>
      <nav class="quiz-detail-pager" id="quiz-detail-pager" role="navigation" aria-label="문항 이동">
        <button type="button" class="btn btn-sm quiz-detail-pager-btn" id="btn-quiz-prev">이전 문제</button>
        <span class="quiz-detail-pager-count" id="quiz-slide-label" aria-live="polite"></span>
        <button type="button" class="btn btn-sm quiz-detail-pager-btn quiz-detail-pager-btn--next" id="btn-quiz-next">다음 문제</button>
      </nav>
      <div id="quiz-detail-slide"></div>
    `;

    wirePager();
    renderCurrentSlide();
    wireDetailBatchToolbar();
    updatePdfExportUi();
    startQuizDetailLiveRefresh(id);
  } catch (e) {
    main.innerHTML = "<section class='card panel'>기록을 불러오지 못했습니다.</section>";
  }
}

loadQuizDetail();
