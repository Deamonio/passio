const $ = id => document.getElementById(id);

function createQuizId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `quiz-${t}-${r}`;
}

function setDashboardUserName(name) {
  const full = String(name || "학습자").trim();
  const userName = $("user-name");
  const avatar = $("ava-dash");

  if (userName) {
    userName.textContent = full;
  }

  if (avatar) {
    avatar.textContent = full;
    avatar.title = full;
  }
}

function setAdminEntryVisible(isAdmin) {
  const adminBtn = $("btn-admin-entry");
  if (!adminBtn) {
    return;
  }

  adminBtn.style.display = isAdmin ? "inline-flex" : "none";
}

async function loadMe() {
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) {
      location.href = "/pages/login.html";
      return;
    }

    const d = await r.json();
    const full = d.user?.name || d.user?.username || "학습자";
    let isAdmin = Boolean(d.user?.isAdmin) || String(d.user?.username || "").toLowerCase() === "deamon";

    // 운영 환경에서는 /api/admin/me 검증이 가장 정확하다.
    if (!isAdmin) {
      try {
        const adminRes = await fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" });
        if (adminRes.ok) {
          const adminJson = await adminRes.json();
          isAdmin = Boolean(adminJson?.ok) && Boolean(adminJson?.user?.isAdmin);
        }
      } catch (_) {
        // /api/admin이 없는 로컬 단독 실행에서는 기존 판별값을 유지한다.
      }
    }

    setDashboardUserName(full);
    setAdminEntryVisible(isAdmin);
  } catch (e) {
    location.href = "/pages/login.html";
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

function init() {
  loadMe();

  const startBtn = $("start-btn");
  const logoutBtn = $("btn-logout");

  if (startBtn) {
    startBtn.onclick = () => {
      sessionStorage.setItem("selectedSubject", "network-admin-2");
      const quizId = createQuizId();
      sessionStorage.setItem("activeQuizId", quizId);
      location.href = `/pages/quiz.html?quizId=${encodeURIComponent(quizId)}`;
    };
  }

  if (logoutBtn) {
    logoutBtn.onclick = doLogout;
  }
}

init();
