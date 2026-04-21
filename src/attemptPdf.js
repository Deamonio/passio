"use strict";

/**
 * 퀴즈 세션(시도) PDF 생성 — pdfkit + Noto Sans KR 서브셋 OTF
 *
 * 호출 경로
 * - Express `server.js`가 `/api/quiz/history/:id/pdf` 등에서 이 모듈을 사용
 *
 * 동작 요약
 * - `computePdfReadiness`: 오답에 대해 AI 해설이 모두 채워졌는지 검사(없으면 PDF 생성 거부 가능)
 * - 한글 폰트는 캐시 디렉터리에 OTF를 내려받아 임베드
 *
 * 시스템 맥락: `docs/SYSTEM-ARCHITECTURE.md`
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const PDFDocument = require("pdfkit");

const NOTO_SUBSET_OTF_DEFAULT =
  "https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf";

/**
 * @param {object} detail getQuizAttemptDetail 결과
 * @returns {{ ok: boolean, missingOneBased: number[], total: number }}
 */
function computePdfReadiness(detail) {
  const answers = Array.isArray(detail?.answers) ? detail.answers : [];
  const wrongAnswers = answers.filter(a => a && a.isCorrect !== true);
  const missingOneBased = [];
  answers.forEach((a, i) => {
    if (!a || a.isCorrect === true) {
      return;
    }
    const t = a.aiExplanation != null ? String(a.aiExplanation).trim() : "";
    if (!t) {
      missingOneBased.push(i + 1);
    }
  });
  return {
    ok: wrongAnswers.length > 0 && missingOneBased.length === 0,
    missingOneBased,
    total: answers.length
  };
}

async function ensureKoreanFontPath() {
  if (process.env.PASSIO_KO_FONT) {
    const p = String(process.env.PASSIO_KO_FONT).trim();
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  const dir = path.join(os.tmpdir(), "passio-fonts");
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = path.join(dir, "NotoSansKR-Regular.otf");
  try {
    const st = await fs.promises.stat(dest);
    if (st.size > 1_000_000) {
      return dest;
    }
  } catch {
    /* download */
  }
  const url = String(process.env.PASSIO_KO_FONT_URL || NOTO_SUBSET_OTF_DEFAULT).trim();
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`한글 폰트 다운로드 실패(HTTP ${res.status}). PASSIO_KO_FONT 로 로컬 OTF/TTF 경로를 지정할 수 있습니다.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(dest, buf);
  return dest;
}

function optionMark(oi) {
  return ["①", "②", "③", "④"][oi] || `${oi + 1}.`;
}

function fitTextToHeight(doc, text, width, lineGap, maxHeight, fontSize) {
  const src = String(text || "").trim();
  if (!src) return "";
  doc.fontSize(fontSize);
  const fullH = doc.heightOfString(src, { width, lineGap });
  if (fullH <= maxHeight) {
    return src;
  }
  let lo = 0;
  let hi = src.length;
  let best = "";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cand = `${src.slice(0, mid).trim()}...`;
    const h = doc.heightOfString(cand, { width, lineGap });
    if (h <= maxHeight) {
      best = cand;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best || `${src.slice(0, 80).trim()}...`;
}

/**
 * @param {object} detail
 * @returns {Promise<Buffer>}
 */
async function buildQuizAttemptPdfBuffer(detail) {
  const fontPath = await ensureKoreanFontPath();
  const answers = Array.isArray(detail?.answers) ? detail.answers : [];
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin,
      bufferPages: true,
      autoFirstPage: true
    });
    doc.registerFont("KO", fontPath);
    doc.font("KO");
    doc.on("data", c => chunks.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const drawChip = (x, y, text, bg, fg) => {
      const padX = 8;
      const padY = 3;
      doc.fontSize(8.5).fillColor(fg);
      const tw = doc.widthOfString(text);
      const h = 14;
      doc
        .save()
        .roundedRect(x, y, tw + padX * 2, h, 7)
        .fill(bg)
        .restore();
      doc.fillColor(fg).text(text, x + padX, y + padY, { lineBreak: false });
      return tw + padX * 2;
    };

    const drawHeader = () => {
      doc
        .save()
        .rect(0, 0, pageWidth, pageHeight)
        .fill("#f7f4ef")
        .restore();
      doc
        .save()
        .roundedRect(margin, margin, contentWidth, 92, 12)
        .fill("#ffffff")
        .restore();

      doc.fillColor("#253350").fontSize(17).text(`Passio 세션 #${detail.id}`, margin + 16, margin + 14, {
        width: contentWidth - 32
      });
      doc.fillColor("#6b5e52").fontSize(9.5).text(String(detail.createdAt || ""), margin + 16, margin + 38, {
        width: contentWidth - 32
      });
      doc.fillColor("#6b5e52").fontSize(8.6).text(
        "오답 문항 AI 해설이 포함된 학습 리포트",
        margin + 16,
        margin + 52,
        { width: contentWidth - 32 }
      );
      let chipX = margin + 16;
      const chipY = margin + 67;
      chipX += drawChip(chipX, chipY, `총 ${detail.totalQuestions}문항`, "#ebf0f9", "#253350") + 6;
      chipX += drawChip(chipX, chipY, `정답 ${detail.correctCount}`, "#edfaf2", "#1e6641") + 6;
      drawChip(chipX, chipY, `오답 ${Math.max(0, detail.totalQuestions - detail.correctCount)}`, "#fef2f2", "#b83232");
      doc
        .save()
        .moveTo(margin, margin + 100)
        .lineTo(margin + contentWidth, margin + 100)
        .lineWidth(1)
        .strokeColor("#e6e1d9")
        .stroke()
        .restore();
      doc.y = margin + 106;
    };

    const ensureCardSpace = expectedHeight => {
      if (doc.y + expectedHeight <= pageHeight - margin) {
        return;
      }
      doc.addPage();
      drawHeader();
    };

    drawHeader();

    answers.forEach((a, idx) => {
      const isWrong = a && a.isCorrect !== true;
      const aiText = String(a && a.aiExplanation ? a.aiExplanation : "").trim();
      if (!isWrong || !aiText) {
        return;
      }
      const qTextRaw = String(a.questionText || "").trim();
      const options = Array.isArray(a.options) ? a.options : [];
      const qText = fitTextToHeight(doc, qTextRaw || "-", contentWidth - 24, 2, 120, 10.2) || "-";
      doc.fontSize(10.2);
      const questionHeight = Math.max(48, doc.heightOfString(qText, { width: contentWidth - 24, lineGap: 2 }) + 20);
      const optionsHeight = 20 * Math.max(1, options.length) + 20;
      const explanationRaw = a.explanation && String(a.explanation).trim() ? String(a.explanation).trim() : "";
      const explanationText = explanationRaw
        ? fitTextToHeight(doc, `문제은행 해설: ${explanationRaw}`, contentWidth - 24, 2, 72, 8.8)
        : "";
      doc.fontSize(8.8);
      const explanationHeight = explanationText
        ? doc.heightOfString(explanationText, { width: contentWidth - 24, lineGap: 2 }) + 8
        : 0;

      const aiFitted = fitTextToHeight(doc, aiText, contentWidth - 40, 3, 240, 9.2);
      doc.fontSize(9.2);
      const aiBodyHeight = doc.heightOfString(aiFitted, { width: contentWidth - 40, lineGap: 3 });
      const aiHeight = Math.max(86, aiBodyHeight + 34);
      const cardHeight = 28 + questionHeight + optionsHeight + explanationHeight + aiHeight + 24;
      ensureCardSpace(cardHeight + 16);

      const x = margin;
      const y = doc.y;
      doc.save().roundedRect(x, y, contentWidth, cardHeight, 12).fill("#ffffff").restore();
      doc
        .save()
        .roundedRect(x, y, contentWidth, cardHeight, 12)
        .lineWidth(1)
        .strokeColor("#ddd8cf")
        .stroke()
        .restore();
      doc.save().roundedRect(x, y, contentWidth, 30, 12).fill("#f0ede7").restore();
      doc
        .fillColor("#253350")
        .fontSize(10.8)
        .text(`문제 ${idx + 1} / ${answers.length}`, x + 12, y + 9, { lineBreak: false });
      drawChip(x + contentWidth - 70, y + 8, "오답", "#fef2f2", "#b83232");

      let cy = y + 38;
      doc
        .fillColor("#17130e")
        .fontSize(10.2)
        .text(qText || "-", x + 12, cy, { width: contentWidth - 24, lineGap: 2 });
      cy += questionHeight;

      options.forEach((opt, oi) => {
        const ox = x + 12;
        const oy = cy;
        const isCorrect = Number.isInteger(a.correctIndex) && oi === a.correctIndex;
        const isSelected = Number.isInteger(a.selectedIndex) && oi === a.selectedIndex;
        const bg = isCorrect ? "#edfaf2" : isSelected ? "#fef2f2" : "#f7f4ef";
        const fg = isCorrect ? "#1e6641" : isSelected ? "#b83232" : "#6b5e52";
        doc.save().roundedRect(ox, oy, contentWidth - 24, 17, 6).fill(bg).restore();
        doc
          .fillColor(fg)
          .fontSize(8.8)
          .text(`${optionMark(oi)} ${String(opt || "").trim()}`, ox + 7, oy + 5, {
            width: contentWidth - 36,
            lineBreak: false,
            ellipsis: true
          });
        let tag = "";
        if (isCorrect) tag = "정답";
        if (isSelected && !isCorrect) tag = "내 선택";
        if (tag) {
          drawChip(ox + contentWidth - 96, oy + 2, tag, "#ffffff", fg);
        }
        cy += 20;
      });

      if (a.explanation && String(a.explanation).trim()) {
        doc
          .fillColor("#6b5e52")
          .fontSize(8.8)
          .text(explanationText, x + 12, cy + 2, {
            width: contentWidth - 24,
            lineGap: 2
          });
        cy += explanationHeight;
      }

      doc.save().roundedRect(x + 12, cy, contentWidth - 24, aiHeight - 8, 8).fill("#ebf0f9").restore();
      doc
        .save()
        .roundedRect(x + 12, cy, contentWidth - 24, aiHeight - 8, 8)
        .lineWidth(1)
        .strokeColor("#c8d7f0")
        .stroke()
        .restore();
      doc.fillColor("#253350").fontSize(9.4).text("AI 해설", x + 20, cy + 10, { lineBreak: false });
      doc.fillColor("#17130e").fontSize(9.2).text(aiFitted, x + 20, cy + 25, {
        width: contentWidth - 40,
        lineGap: 3
      });
      doc.y = y + cardHeight + 14;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const label = `${i + 1} / ${range.count}`;
      doc
        .fontSize(8.5)
        .fillColor("#b0a08f")
        .text(label, margin, pageHeight - 22, { width: contentWidth, align: "right" });
    }

    doc.end();
  });
}

module.exports = {
  computePdfReadiness,
  buildQuizAttemptPdfBuffer
};
