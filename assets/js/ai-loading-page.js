const $ = id => document.getElementById(id);
let pollTimer = null;

function readJobId() {
  const params = new URLSearchParams(location.search);
  const id = Number(params.get("jobId"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadMe() {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) {
      location.href = "/pages/login.html";
      return false;
    }

    const d = await r.json();
    const full = d.user?.name || d.user?.username || "학습자";
    $("ava-loading").textContent = full;
    $("ava-loading").title = full;
    return true;
  } catch (e) {
    location.href = "/pages/login.html";
    return false;
  }
}

async function doLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch (e) {
    // Ignore network errors.
  }
  location.href = "/pages/index.html";
}

function setStatus(text, type = "") {
  $("loading-status").textContent = text;
  const msg = $("loading-msg");
  msg.className = `msg ${type}`;
  msg.textContent = type === "err" ? text : "";
}

function setRetryActions(html = "") {
  const wrap = $("loading-retry-actions");
  if (!wrap) return;
  wrap.innerHTML = html;
  wrap.style.display = html ? "flex" : "none";
}

function getRagJobRetryPayload(job) {
  return {
    question: String(job?.questionText || "").trim(),
    options: [job?.option1, job?.option2, job?.option3, job?.option4].map(value => String(value || "").trim()),
    wrongChoice: String(job?.wrongChoice || "").trim(),
    answerChoice: String(job?.answerChoice || "").trim(),
    rebuild_db: Boolean(job?.requestPayload?.rebuild_db)
  };
}

async function retryRagJob(job, btn) {
  const payload = getRagJobRetryPayload(job);
  if (!payload.question || payload.options.some(x => !x) || payload.options.length !== 4) {
    setStatus("재시도에 필요한 원본 문제 정보가 부족합니다.", "err");
    return;
  }

  const prevText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "재시도 생성 중...";
  }

  try {
    const params = new URLSearchParams(location.search);
    const fromQuiz = params.get("fromQuiz");
    const response = await fetch("/api/rag2/jobs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new Error(data.message || data.detail || "재시도 작업 생성에 실패했습니다.");
    }

    const jobId = data.jobId != null ? data.jobId : data.id;
    let next = `/pages/ai-loading.html?jobId=${encodeURIComponent(String(jobId))}`;
    if (fromQuiz) next += `&fromQuiz=${encodeURIComponent(fromQuiz)}`;
    location.href = next;
  } catch (error) {
    setStatus(error.message || "재시도 작업 생성에 실패했습니다.", "err");
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || "다시 시도";
    }
  }
}

async function pollJob(jobId) {
  try {
    const r = await fetch(`/api/rag/jobs/${jobId}`, { credentials: "same-origin", cache: "no-store" });
    const d = await r.json();
    if (!r.ok) {
      setRetryActions("");
      setStatus(d.message || "작업 정보를 불러오지 못했습니다.", "err");
      return;
    }

    const job = d.job || {};
    if (job.status === "completed") {
      setRetryActions("");
      // fromQuiz 파라미터가 있으면 quiz-attempt(세션 상세)로 이동, 아니면 기존대로 history로 이동
      const params = new URLSearchParams(location.search);
      const fromQuiz = params.get("fromQuiz");
      if (fromQuiz) {
        const slideFromUrl = params.get("slide");
        const slideFromJob =
          job.quizAttemptAnswerIndex != null && job.quizAttemptAnswerIndex !== ""
            ? String(job.quizAttemptAnswerIndex)
            : "";
        const slide =
          slideFromUrl != null && slideFromUrl !== "" ? slideFromUrl : slideFromJob;
        let u = `/pages/quiz-attempt.html?id=${encodeURIComponent(fromQuiz)}&ragJobId=${encodeURIComponent(String(jobId))}`;
        if (slide !== "") {
          u += `&slide=${encodeURIComponent(slide)}`;
        }
        location.href = u;
      } else {
        location.href = `/pages/history.html?ragJobId=${encodeURIComponent(String(jobId))}`;
      }
      return;
    }

    if (job.status === "failed") {
      setRetryActions(`<button class="btn btn-navy" id="btn-retry-job" type="button">다시 시도</button>`);
      setStatus(job.errorMessage || "AI 해설 생성에 실패했습니다.", "err");
      const retryBtn = $("btn-retry-job");
      if (retryBtn) {
        retryBtn.onclick = () => retryRagJob(job, retryBtn);
      }
      return;
    }

    setRetryActions("");
    setStatus(job.status === "processing"
      ? "AI가 문제를 분석하고 해설을 작성하는 중입니다. 완료되면 히스토리로 이동합니다."
      : "작업 큐에 등록되었습니다. 곧 분석이 시작됩니다.");
  } catch (e) {
    setRetryActions("");
    setStatus("네트워크 오류로 상태를 확인하지 못했습니다.", "err");
  }
}

async function init() {
  const ok = await loadMe();
  if (!ok) return;

  $("btn-logout").onclick = doLogout;

  const jobId = readJobId();
  if (!jobId) {
    setStatus("유효한 작업 번호가 없습니다.", "err");
    return;
  }

  await pollJob(jobId);
  pollTimer = window.setInterval(() => {
    pollJob(jobId);
  }, 3000);
  window.addEventListener("beforeunload", () => {
    if (pollTimer) {
      window.clearInterval(pollTimer);
    }
  });
}

init();
