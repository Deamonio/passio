/**
 * 퀴즈 상세 / RAG 상세 / 히스토리 — AI 해설 섹션 HTML 통일
 * (전역 QuizAiBlocks)
 */
(function attachQuizAiBlocks(global) {
  "use strict";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function nlToBr(s) {
    return String(s || "").replace(/\n/g, "<br>");
  }

  function analysisOptionToText(val) {
    if (val == null) return "";
    if (typeof val === "string") return val.trim();
    if (typeof val === "object" && val !== null && "text" in val) return String(val.text || "").trim();
    return "";
  }

  function quizAiSection(title, innerHtml, tone, stacked) {
    const bodyCls = stacked ? "quiz-ai-sec-body quiz-ai-sec-body--stack" : "quiz-ai-sec-body";
    const t = String(title || "").trim();
    const head = t.startsWith("|") ? escapeHtml(t) : `| ${escapeHtml(t)}`;
    return `<section class="quiz-ai-sec quiz-ai-sec--${tone}"><div class="quiz-ai-sec-head"><span class="quiz-ai-sec-bar" aria-hidden="true"></span><span class="quiz-ai-sec-title">${head}</span></div><div class="${bodyCls}">${innerHtml}</div></section>`;
  }

  function buildQuizAiExplainFromAnswer(a) {
    const payload = a.aiRagPayload;
    const plain = a.aiExplanation ? String(a.aiExplanation).trim() : "";

    if (!payload && !plain) return "";

    if (!payload) {
      return `<div class="quiz-ai-rag">${quizAiSection(
        "AI 해설",
        `<div class="quiz-ai-copy">${nlToBr(escapeHtml(plain))}</div>`,
        "muted"
      )}</div>`;
    }

    let p = payload;
    if (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch {
        return plain
          ? `<div class="quiz-ai-rag">${quizAiSection("AI 해설", `<div class="quiz-ai-copy">${nlToBr(escapeHtml(plain))}</div>`, "muted")}</div>`
          : "";
      }
    }

    const first = Array.isArray(p.results) && p.results.length ? p.results[0] : {};
    const report = first.report || p.report || {};
    const body = report.body || {};
    const audit = report.audit || {};
    const overview = String(body.overview || "").trim();
    const analysis = body.analysis;
    const correction = String(body.correction || "").trim();
    const insight = String(body.insight || "").trim();
    const magic = String(report.magic_tip || body.magic_tip || "").trim();
    const rawEvidence = Array.isArray(first.evidence) ? first.evidence : Array.isArray(p.evidence) ? p.evidence : [];
    const refinedEvidence =
      Array.isArray(audit.refined_evidence) && audit.refined_evidence.length ? audit.refined_evidence : rawEvidence;
    const evidenceIds = Array.isArray(audit.evidence_ids) ? audit.evidence_ids : [];
    const hasWrong =
      Number.isInteger(a.selectedIndex) &&
      Number.isInteger(a.correctIndex) &&
      a.selectedIndex !== a.correctIndex &&
      !a.isCorrect;
    const correctionLabel = hasWrong ? "오답 분석" : "함정 탈출 꿀팁!";

    const sections = [];

    if (overview) {
      sections.push(quizAiSection("AI 해설", `<div class="quiz-ai-copy">${nlToBr(escapeHtml(overview))}</div>`, "muted"));
    }

    if (analysis && typeof analysis === "object" && !Array.isArray(analysis)) {
      const keys = Object.keys(analysis).sort((x, y) => (Number(x) || 0) - (Number(y) || 0) || String(x).localeCompare(String(y)));
      const inner = keys
        .map(key => {
          const t = analysisOptionToText(analysis[key]);
          if (!t) return "";
          return `<div class="quiz-ai-opt"><strong class="quiz-ai-opt-k">${escapeHtml(String(key))}번 보기</strong><p class="quiz-ai-copy">${nlToBr(escapeHtml(t))}</p></div>`;
        })
        .filter(Boolean)
        .join("");
      if (inner) sections.push(quizAiSection("보기별 해설", inner, "muted", true));
    }

    if (correction) {
      sections.push(
        quizAiSection(
          correctionLabel,
          `<div class="quiz-ai-copy quiz-ai-copy--warm">${nlToBr(escapeHtml(correction))}</div>`,
          "warm"
        )
      );
    }

    if (insight) {
      sections.push(
        quizAiSection("INSIGHT", `<div class="quiz-ai-copy quiz-ai-copy--green">${nlToBr(escapeHtml(insight))}</div>`, "green")
      );
    }

    if (magic) {
      sections.push(
        quizAiSection("시험장 한 줄 팁", `<div class="quiz-ai-copy quiz-ai-copy--tip">${escapeHtml(magic)}</div>`, "blue")
      );
    }

    if (refinedEvidence.length) {
      const chips = `<div class="quiz-ai-chips"><span class="quiz-ai-chip">ID: ${escapeHtml(evidenceIds.join(", ") || "없음")}</span><span class="quiz-ai-chip">Source: ${escapeHtml(String(audit.source || "공식 학습 이론"))}</span></div>`;
      const evItems = refinedEvidence
        .map((item, i) => {
          const rid = item?.id ?? evidenceIds[i] ?? "-";
          const txt = String(item?.text || "(내용 없음)");
          return `<article class="quiz-ai-ev"><span class="quiz-ai-ev-id">#${escapeHtml(String(rid))}</span><p class="quiz-ai-copy">${nlToBr(escapeHtml(txt))}</p></article>`;
        })
        .join("");
      sections.push(quizAiSection("REFINED EVIDENCE", `${chips}${evItems}`, "dark", true));
    }

    if (!sections.length && plain) {
      sections.push(quizAiSection("AI 해설", `<div class="quiz-ai-copy">${nlToBr(escapeHtml(plain))}</div>`, "muted"));
    }

    if (!sections.length) return "";

    return `<div class="quiz-ai-rag">${sections.join("")}</div>`;
  }

  function buildQuizAiExplainFromJob(job) {
    if (!job) return "";
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

    const options = [job.option1, job.option2, job.option3, job.option4]
      .map(x => String(x || "").trim())
      .filter(Boolean);
    const userWrong = job.wrongChoice ? String(job.wrongChoice).trim() : "";
    let wrongIdx = -1;
    if (userWrong) {
      wrongIdx = options.findIndex(o => o === userWrong);
    }
    const selectedIndex = wrongIdx >= 0 ? wrongIdx : null;

    let finalAns = job.answerChoice ? String(job.answerChoice).trim() : "";
    let correctIndex = -1;
    if (/^[1-4]$/.test(finalAns)) {
      correctIndex = parseInt(finalAns, 10) - 1;
    } else {
      correctIndex = options.findIndex(o => o === finalAns);
    }
    if (correctIndex < 0) {
      correctIndex = 0;
    }

    const isCorrect = !(wrongIdx >= 0 && wrongIdx !== correctIndex);

    const synthetic = {
      aiRagPayload: responsePayload,
      aiExplanation: null,
      selectedIndex,
      correctIndex,
      isCorrect
    };
    return buildQuizAiExplainFromAnswer(synthetic);
  }

  global.QuizAiBlocks = {
    escapeHtml,
    nlToBr,
    buildQuizAiExplainFromAnswer,
    buildQuizAiExplainFromJob
  };
})(typeof window !== "undefined" ? window : globalThis);
