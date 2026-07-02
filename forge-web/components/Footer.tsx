export function Footer() {
  return (
    <footer style={{borderTop: '1px solid var(--border)', padding: 48, maxWidth: 1160, margin: '0 auto', color: 'var(--text-4)'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', gap: 32, marginBottom: 40}}>
        <div style={{maxWidth: 240}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12}}>
            <svg width="28" height="28" viewBox="0 0 30 30" fill="none"><rect width="30" height="30" rx="8" fill="#FF6363"/><path d="M7 8h16v3.5H18v2.5h4.5v3H18V22h-4V8z" fill="white" opacity="0.95"/><rect x="7" y="8" width="7" height="3.5" fill="white"/><circle cx="23" cy="7" r="1.5" fill="white" opacity="0.7"/><circle cx="25" cy="10" r="1" fill="white" opacity="0.5"/></svg>
            <span style={{fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em'}}>VeriTutor</span>
          </div>
          <p style={{fontSize: 13, color: 'var(--text-4)', lineHeight: 1.65}}>AI certification tutor platform for real understanding and practical exam readiness.</p>
        </div>
        <div style={{display: 'flex', gap: 64}}>
          <div>
            <h4 style={{fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 16, letterSpacing: 0.1}}>Services</h4>
            <ul style={{listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, padding: 0}}>
              <li><a href="#">Features</a></li>
              <li><a href="#">Certifications</a></li>
              <li><a href="#">Learning Flow</a></li>
            </ul>
          </div>
          <div>
            <h4 style={{fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 16, letterSpacing: 0.1}}>Support</h4>
            <ul style={{listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, padding: 0}}>
              <li><a href="#">Contact</a></li>
              <li><a href="#">Terms</a></li>
              <li><a href="#">Privacy Policy</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 24, borderTop: '1px solid var(--border)'}}>
        <p style={{fontSize: 12, color: 'var(--text-5)', letterSpacing: 0.2}}>© 2026 VeriTutor. All rights reserved.</p>
        <div style={{display: 'flex', gap: 8}}>
          <span style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-4)', letterSpacing: 0.3}}>Powered by AI</span>
        </div>
      </div>
    </footer>
  );
}
