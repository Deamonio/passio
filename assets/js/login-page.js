const form = document.getElementById('login-form');
const msg = document.getElementById('login-msg');
const btn = document.getElementById('login-btn');

function setMsg(type, text) {
  msg.className = `msg ${type || ''}`;
  msg.textContent = text || '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    setMsg('err', '아이디와 비밀번호를 모두 입력해주세요.');
    return;
  }

  btn.disabled = true;
  setMsg('', '');
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || '로그인에 실패했습니다.');
    setMsg('ok', `${d.user.name}님, 학습 페이지로 이동합니다.`);
    setTimeout(() => { location.href = '/pages/dashboard.html'; }, 700);
  } catch (err) {
    setMsg('err', err.message);
  } finally {
    btn.disabled = false;
  }
});
