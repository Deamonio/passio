const $ = id => document.getElementById(id);

const ST = {
  userName: "학습자",
  filters: [],
  certificate: "",
  subject: "",
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
  loadSeq: 0
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseQuery() {
  const params = new URLSearchParams(location.search);
  const certificate = String(params.get("certificate") || "").trim();
  const subject = String(params.get("subject") || "").trim();
  const page = Math.max(1, Number(params.get("page") || 1) || 1);

  ST.certificate = certificate;
  ST.subject = subject;
  ST.page = page;
}

function replaceBankLocationSearch(nextParams) {
  const url = new URL(location.href);
  url.search = "";
  nextParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  window.history.replaceState(null, "", url.pathname + url.search);
}

function syncQuery() {
  const params = new URLSearchParams();
  if (ST.certificate) {
    params.set("certificate", ST.certificate);
  }
  if (ST.subject) {
    params.set("subject", ST.subject);
  }
  params.set("page", String(ST.page));
  replaceBankLocationSearch(params);
}

function showCardMessage(article, type, text) {
  const msg = article.querySelector("[data-role='explain-msg']");
  if (!msg) {
    return;
  }
  msg.className = type ? `msg ${type}` : "msg";
  msg.textContent = text;
}

async function requestExplainFromBankQuestion(questionId, article, buttonEl) {
  if (buttonEl) {
    buttonEl.disabled = true;
  }
  showCardMessage(article, "", "AI 해설 작업을 생성하는 중...");

  try {
    const detailRes = await fetch(`/api/quiz/questions?questionId=${encodeURIComponent(String(questionId))}`, {
      credentials: "same-origin",
      cache: "no-store"
    });

    const detailJson = await detailRes.json();
    if (!detailRes.ok) {
      showCardMessage(article, "err", detailJson.message || "문제 정보를 가져오지 못했습니다.");
      return;
    }

    const q = Array.isArray(detailJson.questions) ? detailJson.questions[0] : null;
    const options = Array.isArray(q?.options) ? q.options.map(opt => String(opt || "").trim()) : [];
    const answerText = Number.isInteger(q?.answer) && q.answer >= 0 && q.answer < options.length
      ? options[q.answer]
      : "";

    if (!q || !String(q.question || "").trim() || options.length !== 4 || options.some(x => !x)) {
      showCardMessage(article, "err", "해설 요청에 필요한 문제 데이터가 올바르지 않습니다.");
      return;
    }

    const ragRes = await fetch("/api/rag2/jobs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: String(q.question || "").trim(),
        options,
        wrongChoice: "",
        answerChoice: answerText,
        rebuild_db: false
      })
    });

    let ragJson = {};
    try {
      ragJson = await ragRes.json();
    } catch {
      ragJson = {};
    }
    if (!ragRes.ok) {
      showCardMessage(article, "err", ragJson.message || ragJson.detail || "AI 해설 요청 생성에 실패했습니다.");
      return;
    }

    const jobId = ragJson.jobId != null ? ragJson.jobId : ragJson.id;
    location.href = `/pages/ai-loading.html?jobId=${encodeURIComponent(String(jobId))}`;
  } catch (e) {
    showCardMessage(article, "err", "네트워크 오류로 해설 요청을 생성하지 못했습니다.");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
    }
  }
}

function makeCard(question) {
  const article = document.createElement("article");
  article.className = "card bank-item";
  article.dataset.questionId = String(question.id);

  const preview = String(question.question || "").slice(0, 120);
  const shortPreview = String(question.question || "").length > 120 ? `${preview}...` : preview;
  const certLabel = String(question.certificate || "기타").trim();
  const subLabel = String(question.subSubject || question.subject || "세부 과목 없음").trim();

  const head = document.createElement("div");
  head.className = "bank-item-head";

  const strong = document.createElement("strong");
  strong.textContent = `문제 ID ${question.id}`;

  const chip = document.createElement("span");
  chip.className = "dash-chip";
  chip.textContent = `${certLabel} \xb7 ${subLabel}`;

  head.appendChild(strong);
  head.appendChild(chip);

  const qdiv = document.createElement("div");
  qdiv.className = "bank-q";
  qdiv.textContent = shortPreview || "문항 내용 없음";

  const actions = document.createElement("div");
  actions.className = "bank-item-actions";

  const solveA = document.createElement("a");
  solveA.className = "btn btn-navy btn-sm";
  solveA.href = `/pages/quiz.html?questionId=${encodeURIComponent(String(question.id))}`;
  solveA.textContent = "이 문제 풀기";

  const explainBtn = document.createElement("button");
  explainBtn.type = "button";
  explainBtn.className = "btn btn-navy btn-sm bank-explain-btn";
  explainBtn.dataset.action = "explain";
  explainBtn.textContent = "AI 해설보기";
  explainBtn.addEventListener("click", () => {
    requestExplainFromBankQuestion(question.id, article, explainBtn);
  });

  actions.appendChild(solveA);
  actions.appendChild(explainBtn);

  const msg = document.createElement("div");
  msg.className = "msg";
  msg.dataset.role = "explain-msg";

  article.appendChild(head);
  article.appendChild(qdiv);
  article.appendChild(actions);
  article.appendChild(msg);

  return article;
}

function repairBankExplainButtons() {
  const list = $("bank-list");
  if (!list) {
    return;
  }

  list.querySelectorAll(".bank-item").forEach(article => {
    if (article.querySelector("[data-action='explain']")) {
      return;
    }

    const qid = Number(article.dataset.questionId);
    if (!Number.isInteger(qid) || qid <= 0) {
      return;
    }

    const actions = article.querySelector(".bank-item-actions");
    if (!actions) {
      return;
    }

    const explainBtn = document.createElement("button");
    explainBtn.type = "button";
    explainBtn.className = "btn btn-navy btn-sm bank-explain-btn";
    explainBtn.dataset.action = "explain";
    explainBtn.textContent = "AI 해설보기";
    explainBtn.addEventListener("click", () => {
      requestExplainFromBankQuestion(qid, article, explainBtn);
    });
    actions.appendChild(explainBtn);
  });
}

function setMetaText() {
  const from = ST.total === 0 ? 0 : (ST.page - 1) * ST.pageSize + 1;
  const to = Math.min(ST.page * ST.pageSize, ST.total);
  const certificateText = ST.certificate || "전체 자격증";
  const subjectText = ST.certificate
    ? (ST.subject ? ` · ${ST.subject}` : " · 전체 세부 과목")
    : " · 자격증을 선택하세요";
  $("bank-meta").textContent = `${certificateText}${subjectText} · ${from}-${to} / 총 ${ST.total}문제`;
  $("page-indicator").textContent = `${ST.page} / ${ST.totalPages}`;

  const statTotal = $("stat-total");
  if (statTotal) {
    statTotal.textContent = String(ST.total.toLocaleString("ko-KR"));
  }

  const statPage = $("stat-page");
  if (statPage) {
    statPage.textContent = `${ST.page} / ${ST.totalPages}`;
  }

  const statScope = $("stat-scope");
  if (statScope) {
    const scopeText = ST.certificate
      ? (ST.subject ? `${ST.certificate} · ${ST.subject}` : ST.certificate)
      : "전체";
    statScope.textContent = scopeText;
  }
}

function fillSubjectOptions() {
  const sel = $("subject-filter");
  const currentCertificate = ST.certificate;

  if (!currentCertificate) {
    ST.subject = "";
    sel.innerHTML = "";
    sel.disabled = true;
    return;
  }

  const cert = ST.filters.find(item => item.name === currentCertificate);
  const subjects = cert ? cert.subjects : [];

  const uniqueByValue = new Map();
  subjects.forEach(item => {
    if (!uniqueByValue.has(item.value)) {
      uniqueByValue.set(item.value, item);
    }
  });
  const uniqueSubjects = Array.from(uniqueByValue.values()).sort((a, b) => a.label.localeCompare(b.label, "ko"));

  sel.innerHTML = "<option value=''>전체 세부 과목</option>";
  uniqueSubjects.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = `${item.label} (${item.count})`;
    sel.appendChild(opt);
  });

  sel.disabled = false;

  if (ST.subject && uniqueSubjects.some(item => item.value === ST.subject)) {
    sel.value = ST.subject;
  } else {
    ST.subject = "";
    sel.value = "";
  }
}

async function loadMe() {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) {
      location.href = "/pages/login.html";
      return false;
    }

    const d = await r.json();
    ST.userName = d.user?.name || d.user?.username || "학습자";
    $("user-name").textContent = ST.userName;
    $("ava-bank").textContent = ST.userName;
    $("ava-bank").title = ST.userName;
    return true;
  } catch (e) {
    location.href = "/pages/login.html";
    return false;
  }
}

async function loadSubjects() {
  const certSel = $("certificate-filter");
  const subSel = $("subject-filter");
  certSel.disabled = true;
  subSel.disabled = true;

  try {
    const r = await fetch("/api/question-bank/subjects", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!r.ok) {
      throw new Error("필터 조회 실패");
    }

    const d = await r.json();
    const certificates = Array.isArray(d.certificates) ? d.certificates : [];
    ST.filters = certificates;

    certSel.innerHTML = "<option value=''>전체 자격증</option>";
    certificates.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.name;
      opt.textContent = `${item.name} (${item.count})`;
      certSel.appendChild(opt);
    });

    if (ST.certificate && certificates.some(item => item.name === ST.certificate)) {
      certSel.value = ST.certificate;
    } else {
      ST.certificate = "";
      certSel.value = "";
    }

    fillSubjectOptions();
  } catch (e) {
    certSel.innerHTML = "<option value=''>자격증을 불러오지 못했습니다</option>";
    subSel.innerHTML = "<option value=''>세부 과목을 불러오지 못했습니다</option>";
  } finally {
    certSel.disabled = false;
    subSel.disabled = !ST.certificate;
  }
}

async function loadQuestions() {
  const seq = ++ST.loadSeq;
  const list = $("bank-list");
  const pagination = $("bank-pagination");
  list.innerHTML = "<section class='card panel'>문제를 불러오는 중...</section>";

  const params = new URLSearchParams();
  params.set("page", String(ST.page));
  params.set("pageSize", String(ST.pageSize));
  if (ST.certificate) {
    params.set("certificate", ST.certificate);
  }
  if (ST.subject) {
    params.set("subject", ST.subject);
  }

  try {
    const r = await fetch(`/api/question-bank/questions?${params.toString()}`, {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!r.ok) {
      throw new Error("문제 조회 실패");
    }

    const d = await r.json();
    const questions = Array.isArray(d.questions) ? d.questions : [];
    ST.total = Number(d.total) || 0;
    ST.page = Number(d.page) || 1;
    ST.pageSize = Number(d.pageSize) || 20;
    ST.totalPages = Math.max(1, Number(d.totalPages) || 1);

    if (seq !== ST.loadSeq) {
      return;
    }

    if (!questions.length) {
      list.innerHTML = "<section class='card panel'>조건에 맞는 문제가 없습니다.</section>";
      pagination.style.display = "none";
      setMetaText();
      syncQuery();
      return;
    }

    list.innerHTML = "";
    questions.forEach(q => list.appendChild(makeCard(q)));
    repairBankExplainButtons();
    requestAnimationFrame(() => repairBankExplainButtons());

    pagination.style.display = "flex";
    $("btn-prev").disabled = ST.page <= 1;
    $("btn-next").disabled = ST.page >= ST.totalPages;

    setMetaText();
    syncQuery();
  } catch (e) {
    if (seq !== ST.loadSeq) {
      return;
    }
    list.innerHTML = "<section class='card panel'>문제를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</section>";
    pagination.style.display = "none";
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

async function init() {
  parseQuery();

  const ok = await loadMe();
  if (!ok) {
    return;
  }

  $("btn-logout").onclick = doLogout;
  $("certificate-filter").onchange = e => {
    ST.certificate = String(e.target.value || "");
    ST.subject = "";
    ST.page = 1;
    fillSubjectOptions();
    loadQuestions();
  };

  $("subject-filter").onchange = e => {
    ST.subject = String(e.target.value || "");
    ST.page = 1;
    loadQuestions();
  };

  $("btn-prev").onclick = () => {
    if (ST.page <= 1) return;
    ST.page -= 1;
    loadQuestions();
  };

  $("btn-next").onclick = () => {
    if (ST.page >= ST.totalPages) return;
    ST.page += 1;
    loadQuestions();
  };

  await loadSubjects();
  await loadQuestions();
  setTimeout(() => repairBankExplainButtons(), 100);
}

window.addEventListener("pageshow", () => {
  requestAnimationFrame(() => {
    repairBankExplainButtons();
    if (document.visibilityState !== "visible") {
      return;
    }
    const list = $("bank-list");
    const hasCards = list && list.querySelector(".bank-item");
    const hasExplain = list && list.querySelector(".bank-explain-btn");
    if (hasCards && !hasExplain) {
      loadQuestions();
    }
  });
});

init();
