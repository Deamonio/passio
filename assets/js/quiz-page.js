const ST = { user: null, qs: [], ans: [], cur: 0, sel: null, startedAt: null, timerId: null };
const $ = id => document.getElementById(id);
const screens = ['screen-dash', 'screen-quiz', 'screen-result'];

function subjectIcon(subject) {
  if (subject.includes('TCP/IP')) return '🌐';
  if (subject.includes('네트워크 일반')) return '🧭';
  if (subject.includes('NOS')) return '🖥️';
  if (subject.includes('운용기기')) return '🛠️';
  return '📘';
}

function show(id) {
  screens.forEach(x => $(x).style.display = x === id ? 'block' : 'none');
  window.scrollTo(0, 0);
}

function setAvas(name) {
  const full = String(name || '학습자').trim();
  const short = full.slice(0, 2).toUpperCase();

  const dash = $('ava-dash');
  if (dash) {
    dash.textContent = full;
    dash.title = full;
  }

  ['ava-quiz', 'ava-result'].forEach(id => {
    const e = $(id);
    if (e) {
      e.textContent = short;
      e.title = full;
    }
  });
}

function setTimerText() {
  if (!ST.startedAt) return;
  const sec = Math.floor((Date.now() - ST.startedAt) / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  $('quiz-time').textContent = `${m}:${s}`;
}

function bindHotkeys() {
  document.addEventListener('keydown', (e) => {
    if ($('screen-quiz').style.display !== 'block') return;
    if (e.key === 'Escape') {
      show('screen-dash');
      return;
    }
    if (e.key >= '1' && e.key <= '4') {
      const idx = Number(e.key) - 1;
      const btn = document.querySelector(`button[data-opt='${idx}']`);
      if (btn) btn.click();
    }
    if (e.key === 'Enter' && !$('btn-next').disabled) {
      $('btn-next').click();
    }
  });
}

async function loadMe() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!r.ok) {
      location.href = '/pages/login.html';
      return;
    }
    const d = await r.json();
    ST.user = d.user?.name || d.user?.username || '학습자';
    $('user-name').textContent = ST.user;
    setAvas(ST.user);
  } catch (e) {
    location.href = '/pages/login.html';
  }
}

async function doLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (e) {
    // Ignore network errors.
  }
  location.href = '/pages/index.html';
}

async function startQuiz() {
  ST.qs = [];
  ST.ans = [];
  ST.cur = 0;
  ST.sel = null;
  ST.startedAt = Date.now();

  if (ST.timerId) clearInterval(ST.timerId);
  ST.timerId = setInterval(setTimerText, 1000);
  setTimerText();

  show('screen-quiz');
  $('quiz-loading').style.display = 'block';
  $('quiz-content').style.display = 'none';

  try {
    const r = await fetch('/api/quiz/questions', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('문제 호출 실패');
    const d = await r.json();
    ST.qs = d.questions || [];
    if (!ST.qs.length) throw new Error('문제가 없습니다');
    renderQuestion(0);
    $('quiz-loading').style.display = 'none';
    $('quiz-content').style.display = 'block';
  } catch (e) {
    $('quiz-loading').innerHTML = `<p style='color:var(--red)'>문제를 불러오지 못했습니다: ${e.message}</p>`;
  }
}

function renderQuestion(i) {
  const q = ST.qs[i];
  const total = ST.qs.length;
  $('q-current').textContent = i + 1;
  $('q-total').textContent = total;
  $('q-no').textContent = `문제 ${i + 1}`;
  $('q-subject').textContent = `${subjectIcon(q.subject)} 네트워크 관리사 2급 · ${q.subject}`;
  $('q-text').textContent = q.question;
  $('q-progress').style.width = `${((i + 1) / total) * 100}%`;

  const wrap = $('q-options');
  wrap.innerHTML = '';
  q.options.forEach((opt, idx) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.dataset.opt = String(idx);
    b.innerHTML = `<span class='opt-tag'>${['A', 'B', 'C', 'D'][idx]}</span>${opt}`;
    b.onclick = () => {
      wrap.querySelectorAll('.opt').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      ST.sel = idx;
      $('btn-next').disabled = false;
    };
    wrap.appendChild(b);
  });

  ST.sel = null;
  $('btn-next').disabled = true;
  $('btn-next').textContent = i === total - 1 ? '결과 보기' : '다음 문제';
  $('remain-count').textContent = total - (i + 1);
}

function goNext() {
  ST.ans.push(ST.sel);
  if (ST.cur < ST.qs.length - 1) {
    ST.cur += 1;
    renderQuestion(ST.cur);
  } else {
    showResult();
  }
}

function showResult() {
  if (ST.timerId) clearInterval(ST.timerId);
  show('screen-result');

  const total = ST.qs.length;
  let ok = 0;
  ST.qs.forEach((q, i) => { if (ST.ans[i] === q.answer) ok += 1; });
  const wrongCount = total - ok;

  $('score').textContent = total === 1 ? (wrongCount === 0 ? '정답' : '오답') : (wrongCount === 0 ? '전체 정답' : `오답 ${wrongCount}개`);
  $('score-msg').textContent = total === 1 ? (wrongCount === 0 ? '정확하게 맞혔어요.' : '틀린 선지를 다시 확인해봐요.') : wrongCount === 0 ? '모든 문제를 맞혔습니다.' : '틀린 문제 중심으로 다시 보면 효율적입니다.';
  $('score-ok').textContent = `정답 ${ok}개`;
  $('score-ng').textContent = `오답 ${wrongCount}개`;

  const spent = Math.floor((Date.now() - ST.startedAt) / 1000);
  const m = String(Math.floor(spent / 60)).padStart(2, '0');
  const s = String(spent % 60).padStart(2, '0');
  $('spent-time').textContent = `${m}:${s}`;

  const list = $('result-list');
  list.innerHTML = '';
  ST.qs.forEach((q, i) => {
    const isOk = ST.ans[i] === q.answer;
    const selectedIndex = Number.isInteger(ST.ans[i]) ? ST.ans[i] : null;
    const el = document.createElement('div');
    el.className = `card answer-item ${isOk ? 'ok' : 'ng'}`;

    const subject = document.createElement('div');
    subject.className = 'answer-subject';
    subject.textContent = `${subjectIcon(q.subject)} ${q.subject}`;

    const question = document.createElement('div');
    question.className = 'answer-q';
    question.textContent = `${i + 1}. ${q.question}`;

    const options = document.createElement('div');
    options.className = 'result-options';

    q.options.forEach((opt, idx) => {
      const optionEl = document.createElement('div');
      optionEl.className = 'result-option';

      if (idx === q.answer) {
        optionEl.classList.add('correct');
      }
      if (selectedIndex === idx) {
        optionEl.classList.add('selected');
      }
      if (selectedIndex === idx && idx !== q.answer) {
        optionEl.classList.add('wrong');
      }

      const badge = document.createElement('span');
      badge.className = 'result-option-tag';
      badge.textContent = ['A', 'B', 'C', 'D'][idx] || String(idx + 1);

      const text = document.createElement('span');
      text.className = 'result-option-text';
      text.textContent = opt;

      optionEl.appendChild(badge);
      optionEl.appendChild(text);

      if (idx === q.answer || selectedIndex === idx) {
        const state = document.createElement('span');
        state.className = 'result-option-state';
        if (idx === q.answer) {
          state.textContent = '정답';
        } else if (selectedIndex === idx) {
          state.textContent = '내 선택';
        }
        optionEl.appendChild(state);
      }

      options.appendChild(optionEl);
    });

    el.appendChild(subject);
    el.appendChild(question);
    el.appendChild(options);
    list.appendChild(el);
  });
}

function init() {
  bindHotkeys();
  loadMe();
  $('start-btn').onclick = startQuiz;
  $('btn-next').onclick = goNext;
  $('btn-exit').onclick = () => show('screen-dash');
  $('btn-retry').onclick = startQuiz;
  $('btn-home').onclick = () => { location.href = '/pages/index.html'; };
  $('btn-logout').onclick = doLogout;
}

init();
