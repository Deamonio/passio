/**
 * 예전 HTML이 이 파일만 가리킬 때: quiz-ai-blocks + quiz-detail-app 로 실제 UI를 로드합니다.
 * - 일반 <script src=...> (defer/async 없음): document.write 동기 삽입
 * - defer/async: 순차 script append (document.write 사용 안 함)
 */
(function () {
  if (window.__PASSIO_QUIZ_LEGACY_PAGE_LOADER__) {
    return;
  }
  window.__PASSIO_QUIZ_LEGACY_PAGE_LOADER__ = 1;

  var BLOCKS = "/assets/js/quiz-ai-blocks.js?v=20260419unifiedAi";
  var APP = "/assets/js/quiz-detail-app.js?v=app20260418h";

  function currentScriptEl() {
    var d = document.currentScript;
    if (d) {
      return d;
    }
    var scripts = document.getElementsByTagName("script");
    return scripts.length ? scripts[scripts.length - 1] : null;
  }

  function syncWrite(src) {
    document.write('<script charset="utf-8" src="' + src + '"><\/script>');
  }

  function appendScript(src, onload) {
    var s = document.createElement("script");
    s.src = src;
    s.charset = "utf-8";
    if (onload) {
      s.onload = onload;
      s.onerror = function () {
        var m = document.getElementById("quiz-detail-main");
        if (m) {
          m.innerHTML =
            "<section class='card panel' style='border:2px solid var(--red);'>" +
            "스크립트 로드 실패: <code>" +
            src +
            "</code></section>";
        }
      };
    }
    (document.head || document.documentElement).appendChild(s);
  }

  function loadAppDeferred() {
    appendScript(APP);
  }

  function loadBlocksThenApp() {
    appendScript(BLOCKS, loadAppDeferred);
  }

  var cur = currentScriptEl();
  var badDefer = cur && (cur.defer || cur.async);

  if (badDefer) {
    if (typeof window.QuizAiBlocks === "undefined") {
      loadBlocksThenApp();
    } else {
      loadAppDeferred();
    }
    return;
  }

  if (typeof window.QuizAiBlocks === "undefined") {
    syncWrite(BLOCKS);
  }
  syncWrite(APP);
})();
