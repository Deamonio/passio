// ─────────────────────────────────────────────
// Passio Admin Page
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

const PAGE_SIZE = 20;

let currentTab = "dashboard";
let currentAdminUser = null;

const DEFAULT_ADMIN_PERMISSIONS = {
  users: { read: true, write: true, delete: true },
  logs: { read: true },
  rag: { read: true, delete: true },
  quiz: { read: true, delete: true },
  questions: { read: true },
};

let adminPerms = null;

function cloneDefaultPerms() {
  return JSON.parse(JSON.stringify(DEFAULT_ADMIN_PERMISSIONS));
}

function hasPerm(section, action) {
  const p = adminPerms || cloneDefaultPerms();
  const sec = p[section] || {};
  return Boolean(sec[action]);
}

function tabRequiresRead(tab) {
  if (!tab || tab === "dashboard") return true;
  const m = {
    users: ["users", "read"],
    logs: ["logs", "read"],
    rag: ["rag", "read"],
    quiz: ["quiz", "read"],
    questions: ["questions", "read"],
  };
  const req = m[tab];
  return req ? hasPerm(req[0], req[1]) : true;
}

function applyAdminPermissionUi() {
  if (!currentAdminUser) return;
  const pairs = [
    ["users", "users"],
    ["logs", "logs"],
    ["rag", "rag"],
    ["quiz", "quiz"],
    ["questions", "questions"],
  ];
  for (const [sec, tab] of pairs) {
    const ok = hasPerm(sec, "read");
    document.querySelectorAll(`[data-tab="${tab}"]`).forEach(el => {
      el.style.display = ok ? "" : "none";
    });
  }
  document.querySelectorAll(".admin-quick-nav [data-tab]").forEach(btn => {
    const t = btn.getAttribute("data-tab");
    const m = { users: "users", logs: "logs", rag: "rag", quiz: "quiz", questions: "questions" };
    const sec = m[t || ""];
    if (sec) btn.style.display = hasPerm(sec, "read") ? "" : "none";
  });
  const hint = $("admin-perm-hint");
  if (hint) {
    const bits = [];
    if (hasPerm("users", "read")) bits.push("사용자 보기");
    if (hasPerm("users", "write")) bits.push("사용자 수정");
    if (hasPerm("users", "delete")) bits.push("사용자 삭제");
    if (hasPerm("logs", "read")) bits.push("로그");
    if (hasPerm("rag", "read")) bits.push("AI해설 보기");
    if (hasPerm("rag", "delete")) bits.push("AI해설 삭제");
    if (hasPerm("quiz", "read")) bits.push("퀴즈 보기");
    if (hasPerm("quiz", "delete")) bits.push("퀴즈 삭제");
    if (hasPerm("questions", "read")) bits.push("문제 DB");
    hint.textContent = bits.length ? `권한: ${bits.join(" · ")}` : "권한: 없음(대시보드만)";
  }
  const wrap = $("wrap-edit-admin-perms");
  if (wrap) wrap.style.display = hasPerm("users", "write") ? "" : "none";

  if (currentTab !== "dashboard" && !tabRequiresRead(currentTab)) switchTab("dashboard");
}

function adminPermBadge(u) {
  if (!u.isAdmin) return '<span class="pill pending">-</span>';
  const p = u.adminPermissions;
  if (p == null || p === undefined) return '<span class="pill ok">기본</span>';
  if (typeof p === "object" && Object.keys(p).length === 0) return '<span class="pill ok">기본</span>';
  return '<span class="pill info">커스텀</span>';
}

// ── 인증 헤더 ──
function authHeaders() {
  return { "Content-Type": "application/json" };
}

// ── 날짜 포맷 ──
function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── HTML 이스케이프 ──
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/** FastAPI `detail` 문자열·배열 모두 표시용 */
function formatApiDetail(d) {
  if (!d) return "";
  const raw = d.detail != null ? d.detail : d.message;
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    return raw
      .map(e => {
        if (e && typeof e === "object" && "msg" in e) return String(e.msg);
        if (e && typeof e === "object" && "loc" in e) return `${JSON.stringify(e.loc)}: ${e.msg || ""}`;
        return JSON.stringify(e);
      })
      .join("\n");
  }
  return String(raw);
}

// ── JSON 하이라이트 ──
function jsonHtml(obj) {
  if (obj == null) return '<span class="json-null">null</span>';
  const str = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return str
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="json-key">$1</span>$2')
    .replace(/: ("(?:[^"\\]|\\.)*")/g, ': <span class="json-str">$1</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');
}

function parseMaybeJson(value, maxDepth = 2) {
  let current = value;
  for (let i = 0; i < maxDepth; i += 1) {
    if (typeof current !== "string") break;
    const trimmed = current.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) break;
    try {
      current = JSON.parse(trimmed);
    } catch (_) {
      break;
    }
  }
  return current;
}

function renderKeyValueTable(obj) {
  const source = obj && typeof obj === "object" ? obj : {};
  const entries = Array.isArray(source)
    ? source.map((v, idx) => [String(idx), v])
    : Object.entries(source);

  const rows = entries.map(([k, v]) => {
    const value = parseMaybeJson(v);
    if (value == null) {
      return `<tr><th style="width:180px;">${esc(k)}</th><td><span class="muted">null</span></td></tr>`;
    }
    if (typeof value === "object") {
      return `<tr>
        <th style="width:180px;">${esc(k)}</th>
        <td>
          <details>
            <summary style="cursor:pointer;">펼쳐보기</summary>
            <div class="json-viewer" style="margin-top:8px;">${jsonHtml(value)}</div>
          </details>
        </td>
      </tr>`;
    }
    return `<tr><th style="width:180px;">${esc(k)}</th><td>${esc(value)}</td></tr>`;
  }).join("");

  if (!rows) return "<p class='muted'>표시할 데이터가 없습니다.</p>";

  return `<div style="overflow-x:auto;"><table class="admin-table"><tbody>${rows}</tbody></table></div>`;
}

function renderAnalysisTable(analysis) {
  const entries = analysis && typeof analysis === "object" ? Object.entries(analysis) : [];
  if (!entries.length) return "<p class='muted'>보기별 분석 데이터가 없습니다.</p>";
  return `
    <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead><tr><th style="width:120px;">보기</th><th>분석 내용</th></tr></thead>
        <tbody>
          ${entries.map(([key, value]) => `<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderRagLogResponseCard(responsePayload) {
  const payload = parseMaybeJson(responsePayload);
  const job = payload?.job || {};
  const resultPayload = parseMaybeJson(job.resultPayload);
  const first = Array.isArray(resultPayload?.results) ? (resultPayload.results[0] || {}) : {};
  const report = first.report || resultPayload?.report || {};
  const body = report.body || {};
  const analysis = body.analysis || {};

  const summary = {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    questionText: job.questionText,
    wrongChoice: job.wrongChoice,
    answerChoice: job.answerChoice,
  };

  /* 보기별 analysis 는 아래 renderAnalysisTable — 여기선 문자열 본문만 */
  const sections = [
    ["개요", body.overview],
    ["정정 해설", body.correction],
    ["핵심 인사이트", typeof body.insight === "string" ? body.insight : null],
    ["Magic Tip", body.magic_tip || report.magic_tip],
    ["정제 해설", body.refined],
  ].filter(([, text]) => text);

  return `
    <div class="detail-field detail-full">
      <label>구조화 응답 (RAG Job)</label>
      ${renderKeyValueTable(summary)}
    </div>
    <div class="detail-field detail-full">
      <label>보기별 분석</label>
      ${renderAnalysisTable(analysis)}
    </div>
    ${sections.map(([title, text]) => `
      <div class="detail-field detail-full">
        <label>${esc(title)}</label>
        <div class="field-val" style="white-space:pre-wrap;line-height:1.7;">${esc(text)}</div>
      </div>`).join("")}
  `;
}

function renderStructuredPayload(endpoint, responsePayload) {
  const parsed = parseMaybeJson(responsePayload);
  if (endpoint && endpoint.startsWith("/api/rag/jobs/") && parsed?.job) {
    return renderRagLogResponseCard(parsed);
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return `
      <div class="detail-field detail-full">
        <label>구조화 응답</label>
        ${renderKeyValueTable(parsed)}
      </div>
    `;
  }

  return "";
}

// ── 상태 pill ──
function statusPill(status) {
  const map = { completed: ["ok","완료"], failed: ["ng","실패"], processing: ["pending","분석중"],
    pending: ["pending","대기"], ok: ["ok","정상"] };
  const [cls, label] = map[status] || ["info", status || "-"];
  return `<span class="pill ${cls}">${label}</span>`;
}

// ── HTTP 상태 pill ──
function httpPill(code) {
  if (!code) return "-";
  const cls = code < 300 ? "ok" : code < 500 ? "pending" : "ng";
  return `<span class="pill ${cls}">${code}</span>`;
}

// ── API 호출 헬퍼 ──
async function apiFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  if (r.status === 401) {
    showLogin("로그인이 필요합니다.");
    return null;
  }
  if (r.status === 403) {
    showLogin("관리자 권한이 없습니다.");
    return null;
  }
  let data = null;
  try {
    data = await r.json();
  } catch (_) {
    data = { ok: false, detail: "JSON 응답이 아닙니다." };
  }
  if (!r.ok && !data.detail) {
    data.detail = `HTTP ${r.status}`;
  }
  return data;
}

// ── 탭 전환 ──
function switchTab(tab) {
  if (tab && !tabRequiresRead(tab)) {
    switchTab("dashboard");
    return;
  }
  currentTab = tab;
  document.querySelectorAll(".admin-tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".admin-nav-link[data-tab]").forEach(l => l.classList.remove("active"));
  const panel = $(`panel-${tab}`);
  if (panel) panel.classList.add("active");
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(l => l.classList.add("active"));
  const titles = { dashboard:"개요", users:"사용자 관리", logs:"API 로그",
    rag:"AI 해설 Jobs", quiz:"퀴즈 기록", questions:"문제 DB" };
  $("topbar-title").textContent = titles[tab] || tab;

  if (tab === "dashboard") loadStats();
  else if (tab === "users") loadUsers();
  else if (tab === "logs") loadLogs(0);
  else if (tab === "rag") loadRagJobs(0);
  else if (tab === "quiz") loadQuizAttempts(0);
  else if (tab === "questions") loadQuestions(0);
}

// ─────────────────────────────────────────────
// 인증 게이트
// ─────────────────────────────────────────────
function showLogin(message = "") {
  $("login-gate").style.display = "block";
  $("admin-app").style.display = "none";
  const err = $("login-err");
  if (message) {
    err.textContent = message;
    err.style.display = "block";
  } else {
    err.textContent = "";
    err.style.display = "none";
  }
}

function showApp() {
  $("login-gate").style.display = "none";
  $("admin-app").style.display = "flex";
}

async function ensureAdminAccess() {
  const r = await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" });
  if (r.status === 401) {
    showLogin("로그인 세션이 없습니다.");
    return false;
  }
  if (r.status === 403) {
    showLogin("관리자 권한이 없습니다.");
    return false;
  }
  if (!r.ok) {
    showLogin("관리자 인증 확인에 실패했습니다.");
    return false;
  }
  let d;
  try {
    d = await r.json();
  } catch (_) {
    showLogin("관리자 인증 응답을 해석하지 못했습니다.");
    return false;
  }
  if (!d.ok || !d.user?.isAdmin) {
    showLogin("관리자 권한이 없습니다.");
    return false;
  }
  currentAdminUser = d.user;
  adminPerms = d.user.permissions || null;
  showApp();
  applyAdminPermissionUi();
  switchTab("dashboard");
  return true;
}

// ─────────────────────────────────────────────
// 대시보드 통계
// ─────────────────────────────────────────────
async function loadStats() {
  const d = await apiFetch("/api/admin/stats");
  if (!d || !d.ok) return;
  const s = d.stats;
  const items = [
    { num: s.users, label: "전체 사용자" },
    { num: s.api_request_logs, label: "API 로그", sub: `24h: ${s.logs_24h}건` },
    { num: s.rag_solve_jobs, label: "AI 해설 Jobs", sub: `완료: ${s.rag_completed}건` },
    { num: s.quiz_attempts, label: "퀴즈 시도" },
    { num: s.quiz_attempt_answers, label: "퀴즈 답안" },
    { num: s.questions, label: "문제 DB" },
    { num: s.user_api_tokens, label: "API 토큰" },
    { num: s.refresh_tokens, label: "Refresh 토큰" },
  ];
  $("stats-grid").innerHTML = items.map(it => `
    <div class="stat-card">
      <div class="stat-num">${it.num?.toLocaleString() ?? "-"}</div>
      <div class="stat-label">${it.label}</div>
      ${it.sub ? `<div class="stat-sub">${it.sub}</div>` : ""}
    </div>`).join("");
}

// ─────────────────────────────────────────────
// 사용자 관리
// ─────────────────────────────────────────────
let allUsers = [];

async function loadUsers() {
  const d = await apiFetch("/api/admin/users");
  if (!d || !d.ok) return;
  allUsers = d.users;
  renderUsers(allUsers);
}

function renderUsers(users) {
  const q = $("user-search").value.trim().toLowerCase();
  const filtered = q
    ? users.filter(u => [u.username,u.name,u.email,u.studentNumber].some(x => x && x.toLowerCase().includes(q)))
    : users;

  $("users-tbody").innerHTML = filtered.map(u => `
    <tr>
      <td class="td-nowrap">${u.id}</td>
      <td><strong>${esc(u.username)}</strong></td>
      <td>${esc(u.name)}</td>
      <td class="td-trunc">${esc(u.email)}</td>
      <td>${u.isAdmin ? '<span class="pill ok">관리자</span>' : '<span class="pill pending">일반</span>'}</td>
      <td class="td-nowrap">${adminPermBadge(u)}</td>
      <td>${esc(u.studentNumber) || "-"}</td>
      <td class="td-nowrap">${fmtDate(u.createdAt)}</td>
      <td class="td-nowrap">
        ${hasPerm("users", "write") ? `<button type="button" class="btn btn-out btn-sm" onclick="openEditModal(${u.id})">수정</button>` : ""}
        ${hasPerm("users", "delete") ? `<button type="button" class="btn btn-sm" style="background:var(--red-l);color:var(--red);border:1px solid var(--red-b);"
          onclick="openDeleteModal(${u.id},'${esc(u.username || u.name)}')">삭제</button>` : ""}
      </td>
    </tr>`).join("");
}

// ── 수정 모달 ──
function openEditModal(userId) {
  if (!hasPerm("users", "write")) {
    window.alert("사용자를 수정할 권한이 없습니다.");
    return;
  }
  const u = allUsers.find(x => x.id === userId);
  if (!u) return;
  $("edit-user-id").value = userId;
  $("edit-username").value = u.username || "";
  $("edit-name").value = u.name || "";
  $("edit-email").value = u.email || "";
  $("edit-password").value = "";
  $("edit-is-admin").checked = Boolean(u.isAdmin);
  const ta = $("edit-admin-permissions");
  if (ta) {
    if (u.adminPermissions != null && typeof u.adminPermissions === "object") {
      ta.value = JSON.stringify(u.adminPermissions, null, 2);
    } else {
      ta.value = "";
    }
  }
  $("edit-err").style.display = "none";
  $("modal-edit-user").classList.add("open");
}

async function saveEditUser() {
  if (!hasPerm("users", "write")) {
    $("edit-err").textContent = "수정 권한이 없습니다.";
    $("edit-err").style.display = "block";
    return;
  }
  const userId = parseInt($("edit-user-id").value);
  const body = {
    username: $("edit-username").value.trim(),
    name: $("edit-name").value.trim(),
    email: $("edit-email").value.trim(),
    password: $("edit-password").value.trim(),
    isAdmin: $("edit-is-admin").checked,
  };
  ["username", "name", "email", "password"].forEach(k => { if (!body[k]) delete body[k]; });

  const wrap = $("wrap-edit-admin-perms");
  const apEl = $("edit-admin-permissions");
  if (wrap && apEl && wrap.style.display !== "none") {
    const raw = apEl.value.trim();
    if (raw === "") body.adminPermissions = null;
    else {
      try {
        body.adminPermissions = JSON.parse(raw);
      } catch (_) {
        $("edit-err").textContent = "관리자 세부 권한 JSON 형식이 올바르지 않습니다.";
        $("edit-err").style.display = "block";
        return;
      }
    }
  }

  if (!Object.keys(body).length) {
    $("edit-err").textContent = "변경할 항목을 입력하세요.";
    $("edit-err").style.display = "block";
    return;
  }
  const d = await apiFetch(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!d) return;
  if (!d.ok) {
    $("edit-err").textContent = formatApiDetail(d) || "저장 실패";
    $("edit-err").style.display = "block";
    return;
  }
  $("modal-edit-user").classList.remove("open");
  loadUsers();
}

// ── 삭제 모달 ──
let _deleteUserId = null;

function openDeleteModal(userId, username) {
  if (!hasPerm("users", "delete")) {
    window.alert("사용자를 삭제할 권한이 없습니다.");
    return;
  }
  _deleteUserId = userId;
  $("delete-confirm-msg").innerHTML = `<strong>${esc(username)}</strong> (ID: ${userId}) 계정과 관련 데이터를 모두 삭제합니다. 이 작업은 되돌릴 수 없습니다.`;
  $("modal-delete-user").classList.add("open");
}

async function confirmDeleteUser() {
  if (!hasPerm("users", "delete")) return;
  if (!_deleteUserId) return;
  const d = await apiFetch(`/api/admin/users/${_deleteUserId}`, { method: "DELETE" });
  if (!d) return;
  if (!d.ok) {
    window.alert(formatApiDetail(d) || "삭제에 실패했습니다.");
    return;
  }
  $("modal-delete-user").classList.remove("open");
  _deleteUserId = null;
  loadUsers();
}

// ─────────────────────────────────────────────
// API 로그
// ─────────────────────────────────────────────
let logsPage = 0;
let logsTotal = 0;
let logsById = new Map();

async function loadLogs(page = 0) {
  logsPage = page;
  const endpoint = $("log-endpoint-filter").value.trim();
  const url = `/api/admin/logs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${endpoint ? `&endpoint=${encodeURIComponent(endpoint)}` : ""}`;
  const d = await apiFetch(url);
  if (!d || !d.ok) return;
  logsTotal = Number(d.total) || 0;
  $("logs-count").textContent = `총 ${logsTotal.toLocaleString()}건`;
  logsById = new Map((d.logs || []).map(item => [Number(item.id), item]));

  const tbody = $("logs-tbody");
  tbody.innerHTML = d.logs.map(log => `
    <tr class="log-row" data-logid="${log.id}" onclick="toggleLogDetail(this, ${log.id})">
      <td class="td-nowrap td-mono">${log.id}</td>
      <td class="td-nowrap">${fmtDate(log.createdAt)}</td>
      <td><span class="pill info">${esc(log.method)}</span></td>
      <td class="td-trunc td-mono" style="max-width:320px;">${esc(log.endpoint)}</td>
      <td>${httpPill(log.statusCode)}</td>
      <td class="td-nowrap">${log.responseTimeMs != null ? log.responseTimeMs + " ms" : "-"}</td>
      <td>${log.userId != null ? log.userId : "-"}</td>
    </tr>
    <tr class="detail-row" id="log-detail-${log.id}" style="display:none;">
      <td colspan="7">
        <div class="detail-inner" id="log-detail-inner-${log.id}"><p class='muted'>상세 정보를 준비 중...</p></div>
      </td>
    </tr>`).join("");

  renderPagination("logs-pagination", logsPage, logsTotal, PAGE_SIZE, p => loadLogs(p));
}

function toggleLogDetail(row, logId) {
  const detail = $(`log-detail-${logId}`);
  if (!detail) return;
  const open = detail.style.display !== "none";
  detail.style.display = open ? "none" : "table-row";
  row.classList.toggle("expanded", !open);

  if (!open) {
    const inner = $(`log-detail-inner-${logId}`);
    if (inner && !inner.dataset.loaded) {
      inner.innerHTML = "<p class='muted'>상세 payload를 불러오는 중...</p>";
      loadLogDetail(logId, inner);
    }
  }
}

async function loadLogDetail(logId, inner) {
  const d = await apiFetch(`/api/admin/logs/${logId}`);
  if (!d || !d.ok || !d.log) {
    inner.innerHTML = "<p class='muted'>상세 정보를 불러오지 못했습니다.</p>";
    return;
  }
  inner.innerHTML = renderLogDetail(d.log);
  inner.dataset.loaded = "1";
}

function summarizePayload(payload) {
  const parsed = parseMaybeJson(payload);
  if (parsed == null) {
    return { parsed: null, rows: [], kind: "null" };
  }
  if (Array.isArray(parsed)) {
    return {
      parsed,
      rows: [
        ["타입", "array"],
        ["길이", String(parsed.length)],
        ["미리보기", parsed.length ? esc(JSON.stringify(parsed[0]).slice(0, 140)) : "빈 배열"],
      ],
      kind: "array",
    };
  }
  if (typeof parsed !== "object") {
    return {
      parsed,
      rows: [["타입", typeof parsed], ["값", String(parsed)]],
      kind: "primitive",
    };
  }

  const rows = Object.entries(parsed).slice(0, 12).map(([key, value]) => {
    const v = parseMaybeJson(value);
    if (v == null) return [key, "null"];
    if (Array.isArray(v)) return [key, `array(${v.length})`];
    if (typeof v === "object") return [key, `object(${Object.keys(v).length} keys)`];
    const text = String(v);
    return [key, text.length > 140 ? `${text.slice(0, 140)}...` : text];
  });

  return { parsed, rows, kind: "object", totalKeys: Object.keys(parsed).length };
}

function renderPayloadSummary(title, summary, notice = "") {
  if (!summary || summary.kind === "null") {
    return `
      <div class="detail-field detail-full">
        <label>${esc(title)}</label>
        ${notice || ""}
        <p class='muted'>값이 없습니다.</p>
      </div>`;
  }

  const rows = summary.rows.map(([k, v]) => `
    <tr>
      <th style="width:180px;">${esc(k)}</th>
      <td style="word-break:break-word;">${esc(v)}</td>
    </tr>`).join("");

  const extra = summary.kind === "object" && summary.totalKeys > 12
    ? `<p class='muted' style='margin-top:8px;'>총 ${summary.totalKeys}개 키 중 12개만 표시했습니다.</p>`
    : "";

  return `
    <div class="detail-field detail-full">
      <label>${esc(title)}</label>
      ${notice || ""}
      <div style="overflow-x:auto;">
        <table class="admin-table"><tbody>${rows}</tbody></table>
      </div>
      ${extra}
    </div>`;
}

function renderLogDetail(log) {
  const reqSummary = summarizePayload(log.requestPayload);
  const resSummary = summarizePayload(log.responsePayload);
  const req = reqSummary.parsed;
  const res = resSummary.parsed;
  const reqJson = req ? jsonHtml(req) : '<span class="json-null">null</span>';
  const resJson = res ? jsonHtml(res) : '<span class="json-null">null</span>';
  const structured = renderStructuredPayload(log.endpoint, res);
  const reqNotice = req && req._omitted
    ? `<p class='muted'>요청 payload는 시스템 보호를 위해 생략되었습니다. (${esc(req.reason || "omitted")})</p>`
    : (req && req._truncated
      ? `<p class='muted'>요청 payload가 너무 커서 축약 표시됩니다. (원본 ${Number(req._originalChars || 0).toLocaleString()} chars)</p>`
      : "");
  const resNotice = res && res._omitted
    ? `<p class='muted'>응답 payload는 시스템 보호를 위해 생략되었습니다. (${esc(res.reason || "omitted")})</p>`
    : (res && res._truncated
      ? `<p class='muted'>응답 payload가 너무 커서 축약 표시됩니다. (원본 ${Number(res._originalChars || 0).toLocaleString()} chars)</p>`
      : "");

  return `
    <div class="detail-grid">
      <div class="detail-field">
        <label>엔드포인트</label>
        <div class="field-val td-mono">${esc(log.endpoint)}</div>
      </div>
      <div class="detail-field">
        <label>상태 / 응답시간</label>
        <div class="field-val">${httpPill(log.statusCode)} &nbsp; ${log.responseTimeMs != null ? log.responseTimeMs + " ms" : "-"}</div>
      </div>
      ${log.errorMessage ? `<div class="detail-field detail-full">
        <label>에러 메시지</label>
        <div class="field-val" style="color:var(--red);">${esc(log.errorMessage)}</div>
      </div>` : ""}
      ${structured}
      ${renderPayloadSummary("요청 Payload 요약", reqSummary, reqNotice)}
      ${renderPayloadSummary("응답 Payload 요약", resSummary, resNotice)}
      <div class="detail-field detail-full">
        <details>
          <summary style="cursor:pointer;font-weight:600;">요청 Payload 원문 JSON 보기</summary>
          <div class="json-viewer" style="margin-top:10px;">${reqJson}</div>
        </details>
      </div>
      <div class="detail-field detail-full">
        <details>
          <summary style="cursor:pointer;font-weight:600;">응답 Payload 원문 JSON 보기</summary>
          <div class="json-viewer" style="margin-top:10px;">${resJson}</div>
        </details>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// RAG Jobs
// ─────────────────────────────────────────────
let ragPage = 0;
let ragJobsById = new Map();

async function loadRagJobs(page = 0) {
  ragPage = page;
  const d = await apiFetch(`/api/admin/rag-jobs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
  if (!d || !d.ok) return;
  $("rag-count").textContent = `총 ${(Number(d.total) || 0).toLocaleString()}건`;
  ragJobsById = new Map((d.jobs || []).map(item => [Number(item.id), item]));

  $("rag-tbody").innerHTML = d.jobs.map(job => `
    <tr class="rag-row" onclick="toggleRagDetail(this, ${job.id})">
      <td class="td-nowrap td-mono">${job.id}</td>
      <td class="td-nowrap">${fmtDate(job.createdAt)}</td>
      <td>${esc(job.username || job.userId)}</td>
      <td>${statusPill(job.status)}</td>
      <td class="td-trunc" style="max-width:320px;">${esc(job.questionText || "-")}</td>
      <td class="td-nowrap">${job.completedAt ? fmtDate(job.completedAt) : "-"}</td>
      <td class="td-nowrap" onclick="event.stopPropagation()">
        ${hasPerm("rag", "delete")
          ? `<button type="button" class="btn btn-sm" style="background:var(--red-l);color:var(--red);border:1px solid var(--red-b);"
          onclick="event.stopPropagation();deleteRagJob(${job.id})">삭제</button>`
          : "—"}
      </td>
    </tr>
    <tr class="detail-row" id="rag-detail-${job.id}" style="display:none;">
      <td colspan="7">
        <div class="detail-inner" id="rag-detail-inner-${job.id}"><p class='muted'>상세 정보를 준비 중...</p></div>
      </td>
    </tr>`).join("");

  renderPagination("rag-pagination", ragPage, d.total, PAGE_SIZE, p => loadRagJobs(p));
}

async function deleteRagJob(jobId) {
  if (!hasPerm("rag", "delete")) return;
  const ok = window.confirm(`AI 해설 기록 #${jobId}를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`);
  if (!ok) return;
  const d = await apiFetch(`/api/admin/rag-jobs/${jobId}`, { method: "DELETE" });
  if (!d || !d.ok) {
    window.alert(formatApiDetail(d) || "삭제에 실패했습니다.");
    return;
  }
  loadRagJobs(ragPage);
}

function toggleRagDetail(row, jobId) {
  const detail = $(`rag-detail-${jobId}`);
  if (!detail) return;
  const open = detail.style.display !== "none";
  detail.style.display = open ? "none" : "table-row";
  row.classList.toggle("expanded", !open);

  if (!open) {
    const inner = $(`rag-detail-inner-${jobId}`);
    if (inner && !inner.dataset.loaded) {
      const job = ragJobsById.get(Number(jobId));
      if (job) {
        inner.innerHTML = renderRagJobDetail(job);
        inner.dataset.loaded = "1";
      }
    }
  }
}

function renderRagJobDetail(job) {
  // Parse resultPayload
  let rp = job.resultPayload;
  if (typeof rp === "string") { try { rp = JSON.parse(rp); } catch(_) {} }
  if (typeof rp === "string") { try { rp = JSON.parse(rp); } catch(_) {} }

  const results = Array.isArray(rp?.results) ? rp.results : [];
  const first = results[0] || {};
  const report = first.report || rp?.report || {};
  const body = report.body || {};

  let ragHtml = "";
  if (job.status === "completed" && report.meta) {
    const meta = report.meta || {};
    const audit = report.audit || {};
    const answerRows = `
      <div class="answer-rows">
        <div class="answer-row"><span class="ar-label">선택 오답</span><span class="ar-val wrong">${esc(job.wrongChoice)}</span></div>
        <div class="answer-row"><span class="ar-label">정답</span><span class="ar-val correct">${esc(job.answerChoice)}</span></div>
      </div>`;

    const sections = [
      { key: "overview", title: "개요" },
      { key: "analysis", title: "오답 분석" },
      { key: "correction", title: "정정 해설" },
      { key: "insight", title: "핵심 인사이트" },
      { key: "magic_tip", title: "Magic Tip" },
      { key: "refined", title: "정제 해설" },
    ];
    const sectHtml = sections.map(sc => {
      const val = body[sc.key];
      if (!val) return "";
      return `<div class="rag-section"><div class="rag-section-title">${sc.title}</div><div class="rag-body"><p>${esc(val)}</p></div></div>`;
    }).join("");

    ragHtml = `
      <div class="detail-grid" style="margin-bottom:14px;">
        <div class="detail-field"><label>판정</label><div class="field-val">${statusPill(audit.verdict || "completed")}</div></div>
        <div class="detail-field"><label>RAG 신뢰도</label><div class="field-val">${meta.rag_relevance_score != null ? meta.rag_relevance_score : "-"}</div></div>
        <div class="detail-field detail-full"><label>문제</label><div class="field-val">${esc(job.questionText)}</div></div>
        <div class="detail-field detail-full"><label>오답/정답</label>${answerRows}</div>
      </div>
      ${sectHtml}`;
  } else if (job.status === "failed") {
    ragHtml = `<div style="color:var(--red);">${esc(job.errorMessage || "오류 정보 없음")}</div>`;
  } else if (job.status === "processing") {
    ragHtml = `<div style="color:var(--amber);">분석 진행 중...</div>`;
  } else {
    // fallback: show raw JSON
    ragHtml = `<div class="json-viewer">${jsonHtml(rp)}</div>`;
  }

  return ragHtml || `<div class="json-viewer">${jsonHtml(rp)}</div>`;
}

// ─────────────────────────────────────────────
// 퀴즈 기록
// ─────────────────────────────────────────────
let quizPage = 0;

async function loadQuizAttempts(page = 0) {
  quizPage = page;
  const d = await apiFetch(`/api/admin/quiz-attempts?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
  if (!d || !d.ok) return;
  $("quiz-count").textContent = `총 ${(Number(d.total) || 0).toLocaleString()}건`;

  $("quiz-tbody").innerHTML = d.attempts.map(a => `
    <tr class="quiz-row" onclick="toggleQuizDetail(this, ${a.id})">
      <td class="td-nowrap td-mono">${a.id}</td>
      <td class="td-nowrap">${fmtDate(a.createdAt)}</td>
      <td>${esc(a.username || a.userId)}</td>
      <td>${a.totalQuestions}</td>
      <td>${a.correctCount}</td>
      <td><strong>${a.score}점</strong></td>
      <td>${a.durationSec != null ? a.durationSec + "초" : "-"}</td>
      <td class="td-mono td-trunc" style="max-width:120px;">${esc(a.quizUid || "-")}</td>
      <td class="td-nowrap" onclick="event.stopPropagation()">
        ${hasPerm("quiz", "delete")
          ? `<button type="button" class="btn btn-sm" style="background:var(--red-l);color:var(--red);border:1px solid var(--red-b);"
          onclick="event.stopPropagation();deleteQuizAttempt(${a.id})">삭제</button>`
          : "—"}
      </td>
    </tr>
    <tr class="detail-row" id="quiz-detail-${a.id}" style="display:none;">
      <td colspan="9">
        <div class="detail-inner" id="quiz-detail-inner-${a.id}">
          <p class="muted">클릭해서 답안 로드...</p>
        </div>
      </td>
    </tr>`).join("");

  renderPagination("quiz-pagination", quizPage, d.total, PAGE_SIZE, p => loadQuizAttempts(p));
}

async function deleteQuizAttempt(attemptId) {
  if (!hasPerm("quiz", "delete")) return;
  const ok = window.confirm(`퀴즈 기록 #${attemptId}를 삭제할까요? 연관 답안·AI 해설 연계가 함께 삭제되며 되돌릴 수 없습니다.`);
  if (!ok) return;
  const d = await apiFetch(`/api/admin/quiz-attempts/${attemptId}`, { method: "DELETE" });
  if (!d || !d.ok) {
    window.alert(formatApiDetail(d) || "삭제에 실패했습니다.");
    return;
  }
  loadQuizAttempts(quizPage);
}

async function clearAttemptRagJobs(attemptId) {
  if (!hasPerm("rag", "delete")) return;
  const ok = window.confirm(
    `퀴즈 #${attemptId}에 연결된 AI 해설 작업(rag_solve_jobs)만 삭제합니다.\n` +
      "퀴즈 답안·시도 기록은 그대로입니다. 학습자는 퀴즈 상세에서 문항별로 해설을 다시 요청할 수 있습니다.\n\n" +
      "진행할까요?"
  );
  if (!ok) return;
  const d = await apiFetch(`/api/admin/quiz-attempts/${attemptId}/rag-jobs`, { method: "DELETE" });
  if (!d || !d.ok) {
    window.alert(formatApiDetail(d) || "초기화에 실패했습니다.");
    return;
  }
  const n = d.deletedCount != null ? d.deletedCount : "?";
  window.alert(`삭제 완료: ${n}건의 AI 해설 작업이 제거되었습니다.`);
}

async function toggleQuizDetail(row, attemptId) {
  const detail = $(`quiz-detail-${attemptId}`);
  if (!detail) return;
  const open = detail.style.display !== "none";
  if (open) {
    detail.style.display = "none";
    row.classList.remove("expanded");
    return;
  }
  detail.style.display = "table-row";
  row.classList.add("expanded");

  const inner = $(`quiz-detail-inner-${attemptId}`);
  if (inner.dataset.loaded) return;
  inner.innerHTML = "<p class='muted'>답안 로딩 중...</p>";
  const d = await apiFetch(`/api/admin/quiz-attempts/${attemptId}/answers`);
  if (!d || !d.ok) { inner.innerHTML = "<p class='muted'>답안 로드 실패</p>"; return; }
  inner.dataset.loaded = "1";
  const answers = d.answers;
  if (!answers.length) { inner.innerHTML = "<p class='muted'>답안 없음</p>"; return; }

  const ragClearBtn = hasPerm("rag", "delete")
    ? `<button type="button" class="btn btn-sm" style="background:var(--amber-l);color:var(--amber);border:1px solid var(--bd);"
        onclick="event.stopPropagation();clearAttemptRagJobs(${attemptId})">연동 AI 해설 초기화</button>`
    : "";

  inner.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
      <a class="btn btn-out btn-sm" href="/pages/quiz-attempt.html?id=${attemptId}" target="_blank" rel="noopener noreferrer">학습자 퀴즈 상세</a>
      ${ragClearBtn}
    </div>
    <table class="admin-table" style="margin:0;">
      <thead><tr><th>#</th><th>과목</th><th>문제</th><th>내 선택</th><th>정답</th><th>결과</th></tr></thead>
      <tbody>
        ${answers.map((a, i) => `
          <tr>
            <td>${i+1}</td>
            <td>${esc(a.subject || "-")}</td>
            <td class="td-trunc" style="max-width:300px;">${esc(a.questionText)}</td>
            <td>${a.selectedIndex != null ? a.selectedIndex + 1 + "번" : "미선택"}</td>
            <td>${Number(a.correctIndex) + 1}번</td>
            <td>${a.isCorrect ? '<span class="pill ok">정답</span>' : '<span class="pill ng">오답</span>'}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ─────────────────────────────────────────────
// 문제 DB
// ─────────────────────────────────────────────
let qPage = 0;

async function loadQuestions(page = 0) {
  qPage = page;
  const subject = $("q-subject-filter").value.trim();
  const url = `/api/admin/questions?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${subject ? `&subject=${encodeURIComponent(subject)}` : ""}`;
  const d = await apiFetch(url);
  if (!d || !d.ok) return;
  $("q-count").textContent = `총 ${(Number(d.total) || 0).toLocaleString()}건`;

  $("questions-tbody").innerHTML = d.questions.map(q => {
    const ans = Number(q.answer);
    return `
    <tr onclick="toggleQDetail(this, ${q.id})">
      <td class="td-nowrap td-mono">${q.id}</td>
      <td class="td-nowrap">${esc(q.subject)}</td>
      <td class="td-trunc" style="max-width:280px;">${esc(q.question)}</td>
      <td class="td-trunc" style="max-width:120px;">${esc(q.option1)}</td>
      <td class="td-trunc" style="max-width:120px;">${esc(q.option2)}</td>
      <td class="td-trunc" style="max-width:120px;">${esc(q.option3)}</td>
      <td class="td-trunc" style="max-width:120px;">${esc(q.option4)}</td>
      <td><strong>${Number.isFinite(ans) ? ans : q.answer}번</strong></td>
    </tr>
    <tr class="detail-row" id="q-detail-${q.id}" style="display:none;">
      <td colspan="8">
        <div class="detail-inner">
          <div class="detail-grid">
            <div class="detail-field detail-full"><label>문제</label><div class="field-val">${esc(q.question)}</div></div>
            ${[1,2,3,4].map(n => `
              <div class="detail-field">
                <label>${n === ans ? "✓ 정답 " : ""}보기 ${n}</label>
                <div class="field-val" style="${n === ans ? "color:var(--grn);font-weight:600;" : ""}">${esc(q["option"+n])}</div>
              </div>`).join("")}
          </div>
        </div>
      </td>
    </tr>`;
  }).join("");

  renderPagination("q-pagination", qPage, d.total, PAGE_SIZE, p => loadQuestions(p));
}

function toggleQDetail(row, qId) {
  const detail = $(`q-detail-${qId}`);
  if (!detail) return;
  const open = detail.style.display !== "none";
  detail.style.display = open ? "none" : "table-row";
  row.classList.toggle("expanded", !open);
}

// ─────────────────────────────────────────────
// 페이지네이션
// ─────────────────────────────────────────────
function renderPagination(containerId, currentPage, total, pageSize, onPage) {
  const totalNum = Math.max(0, Number(total) || 0);
  const size = Math.max(1, Number(pageSize) || 20);
  const totalPages = totalNum === 0 ? 0 : Math.ceil(totalNum / size);
  const container = $(containerId);
  if (!container || totalPages <= 1) {
    if (container) container.innerHTML = "";
    return;
  }

  const start = Math.max(0, currentPage - 2);
  const end = Math.min(totalPages - 1, currentPage + 2);
  let html = `<button data-page="${currentPage - 1}" ${currentPage === 0 ? "disabled" : ""}>‹</button>`;
  if (start > 0) html += `<button data-page="0">1</button>${start > 1 ? `<span class="page-info">…</span>` : ""}`;
  for (let p = start; p <= end; p++) {
    html += `<button data-page="${p}" class="${p === currentPage ? "active" : ""}">${p + 1}</button>`;
  }
  if (end < totalPages - 1) html += `${end < totalPages - 2 ? `<span class="page-info">…</span>` : ""}<button data-page="${totalPages - 1}">${totalPages}</button>`;
  html += `<button data-page="${currentPage + 1}" ${currentPage >= totalPages - 1 ? "disabled" : ""}>›</button>`;
  html += `<span class="page-info">${currentPage + 1} / ${totalPages}</span>`;
  container.innerHTML = html;

  container.querySelectorAll("button[data-page]").forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener("click", () => {
      const next = Number(btn.getAttribute("data-page"));
      if (Number.isInteger(next) && next >= 0 && next < totalPages) {
        onPage(next);
      }
    });
  });
}

// ─────────────────────────────────────────────
// 이벤트 바인딩
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // 탭 네비게이션
  document.querySelectorAll("[data-tab]").forEach(el => {
    el.addEventListener("click", () => switchTab(el.getAttribute("data-tab")));
  });

  // 로그인 페이지 이동
  $("btn-go-login").onclick = () => {
    location.href = "/pages/login.html";
  };

  // 로그아웃
  $("btn-admin-logout").onclick = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (_) { /* ignore */ }
    location.href = "/pages/index.html";
  };

  // 사용자 검색
  $("user-search").addEventListener("input", () => renderUsers(allUsers));
  $("btn-refresh-users").onclick = loadUsers;

  // 로그 검색
  $("btn-search-logs").onclick = () => loadLogs(0);
  $("btn-refresh-logs").onclick = () => loadLogs(0);
  $("log-endpoint-filter").addEventListener("keydown", e => { if (e.key === "Enter") loadLogs(0); });

  // RAG
  $("btn-refresh-rag").onclick = () => loadRagJobs(0);

  // 퀴즈
  $("btn-refresh-quiz").onclick = () => loadQuizAttempts(0);

  // 문제
  $("btn-search-questions").onclick = () => loadQuestions(0);
  $("btn-refresh-questions").onclick = () => loadQuestions(0);
  $("q-subject-filter").addEventListener("keydown", e => { if (e.key === "Enter") loadQuestions(0); });

  // 수정 모달
  $("btn-edit-cancel").onclick = () => $("modal-edit-user").classList.remove("open");
  $("btn-edit-save").onclick = saveEditUser;
  $("modal-edit-user").addEventListener("click", e => { if (e.target === $("modal-edit-user")) $("modal-edit-user").classList.remove("open"); });

  // 삭제 모달
  $("btn-delete-cancel").onclick = () => $("modal-delete-user").classList.remove("open");
  $("btn-delete-confirm").onclick = confirmDeleteUser;
  $("modal-delete-user").addEventListener("click", e => { if (e.target === $("modal-delete-user")) $("modal-delete-user").classList.remove("open"); });

  // 초기 상태
  ensureAdminAccess();
});
