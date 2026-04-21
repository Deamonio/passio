const $ = id => document.getElementById(id);

function showMessage(type, text) {
  const msg = $("explain-msg");
  msg.className = `msg ${type}`;
  msg.textContent = text;
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
    $("user-name").textContent = full;
    $("ava-explain").textContent = full;
    $("ava-explain").title = full;
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

function readOptions() {
  return [1, 2, 3, 4].map(n => String($(`opt-${n}`).value || "").trim());
}

async function submitSolve() {
  const question = String($("question-input").value || "").trim();
  const options = readOptions();
  const wrongChoice = String($("wrong-choice").value || "").trim();
  const answerChoice = String($("answer-choice").value || "").trim();

  if (!question || !question.trim()) {
    showMessage("err", "문제를 입력해주세요.");
    return;
  }
  if (!Array.isArray(options) || options.length !== 4 || options.some(x => !x || !x.trim())) {
    showMessage("err", "보기 4개를 모두 입력해주세요.");
    return;
  }

  const btn = $("btn-solve");
  btn.disabled = true;
  showMessage("", "AI 해설 작업을 생성하는 중...");

  try {
    const params = new URLSearchParams(location.search);
    const fromQuiz = params.get("fromQuiz");
    const payload = {
      question,
      options,
      wrongChoice,
      answerChoice,
      rebuild_db: false
    };
    const r = await fetch("/api/rag2/jobs", {
      method: "POST",
      credentials: "include",
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
      let errMsg = d.detail || d.message || d.error;
      if (!errMsg) errMsg = JSON.stringify(d);
      showMessage("err", errMsg || "AI 해설 요청 생성에 실패했습니다.");
      return;
    }
    const jobId = d.jobId != null ? d.jobId : d.id;
    let nextUrl = `/pages/ai-loading.html?jobId=${encodeURIComponent(String(jobId))}`;
    if (fromQuiz) nextUrl += `&fromQuiz=${encodeURIComponent(fromQuiz)}`;
    location.href = nextUrl;
  } catch (e) {
    showMessage("err", "네트워크 오류로 요청을 생성하지 못했습니다.");
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  const ok = await loadMe();
  if (!ok) return;

  $("btn-logout").onclick = doLogout;
  $("btn-solve").onclick = submitSolve;

  // fromQuiz 파라미터가 있으면 해당 퀴즈의 첫 문제 자동 채우기 및 바로 해설 생성
  const params = new URLSearchParams(location.search);
  const fromQuiz = params.get("fromQuiz");
  if (fromQuiz) {
    try {
      const r = await fetch(`/api/quiz/history/${fromQuiz}`, { credentials: "same-origin" });
      if (r.ok) {
        const d = await r.json();
        const attempt = d.attempt;
        if (attempt && Array.isArray(attempt.answers) && attempt.answers.length > 0) {
          const a = attempt.answers[0];
          $("question-input").value = a.questionText || "";
          ["opt-1","opt-2","opt-3","opt-4"].forEach((id,i)=>{$(id).value = (a.options && a.options[i]) || "";});
          $("wrong-choice").value = (a.selectedIndex !== undefined && a.selectedIndex !== null && a.selectedIndex !== a.correctIndex && a.options) ? a.options[a.selectedIndex] : "";
          $("answer-choice").value = (a.options && a.options[a.correctIndex]) || "";
          // submitSolve에 attemptId, answerIndex 전달
          setTimeout(()=>submitSolveWithLink(fromQuiz, 0), 400);
        }
      }
    } catch(e) {}
  }
}

// submitSolve를 확장하여 attemptId, answerIndex를 함께 전송
async function submitSolveWithLink(attemptId, answerIndex) {
  const question = String($("question-input").value || "").trim();
  const options = readOptions();
  const wrongChoice = String($("wrong-choice").value || "").trim();
  const answerChoice = String($("answer-choice").value || "").trim();
  if (!question || !question.trim()) {
    showMessage("err", "문제를 입력해주세요.");
    return;
  }
  if (!Array.isArray(options) || options.length !== 4 || options.some(x => !x || !x.trim())) {
    showMessage("err", "보기 4개를 모두 입력해주세요.");
    return;
  }
  const btn = $("btn-solve");
  btn.disabled = true;
  showMessage("", "AI 해설 작업을 생성하는 중...");
  try {
    const params = new URLSearchParams(location.search);
    const fromQuiz = params.get("fromQuiz");
    const payload = {
      question,
      options,
      wrongChoice,
      answerChoice,
      attemptId,
      answerIndex,
      rebuild_db: false
    };
    const r = await fetch("/api/rag/jobs", {
      method: "POST",
      credentials: "include",
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
      let errMsg = d.detail || d.message || d.error;
      if (!errMsg) errMsg = JSON.stringify(d);
      showMessage("err", errMsg || "AI 해설 요청 생성에 실패했습니다.");
      return;
    }
    const jobId = d.jobId != null ? d.jobId : d.id;
    let nextUrl = `/pages/ai-loading.html?jobId=${encodeURIComponent(String(jobId))}`;
    if (fromQuiz) nextUrl += `&fromQuiz=${encodeURIComponent(fromQuiz)}`;
    location.href = nextUrl;
  } catch (e) {
    showMessage("err", "네트워크 오류로 요청을 생성하지 못했습니다.");
  } finally {
    btn.disabled = false;
  }
}

init();