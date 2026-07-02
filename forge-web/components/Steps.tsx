export function Steps() {
  return (
    <section className="section" style={{padding: '80px 48px', maxWidth: 1160, margin: '0 auto'}}>
      <div className="section-header" style={{marginBottom: 56}}>
        <div className="section-kicker" style={{display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, color: 'var(--red)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 16}}>
          <span style={{display: 'inline-block', width: 16, height: 1, background: 'var(--red)'}}></span>
          Learning Flow
        </div>
        <h2 className="section-title" style={{fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 500, color: 'var(--text)', lineHeight: 1.18, letterSpacing: '-0.015em', maxWidth: 540}}>
          Pass in <em style={{fontStyle: 'normal', color: 'var(--red)'}}>3 steps</em>
        </h2>
        <p className="section-desc" style={{fontSize: 16, color: 'var(--text-3)', lineHeight: 1.7, maxWidth: 480, marginTop: 14}}>
          VeriTutor AI Tutor helps with concept clarity, mistake analysis, and exam readiness in one flow.
        </p>
      </div>
      <div className="steps" style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24}}>
        <div className="step-card" style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 28px', boxShadow: 'var(--shadow-card)', overflow: 'hidden'}}>
          <div className="step-num" style={{fontSize: 13, fontWeight: 700, color: 'var(--red)', letterSpacing: 0.5, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8}}>
            Step 1 <span style={{flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(255,99,99,0.3), transparent)'}}></span>
          </div>
          <h3 style={{fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 10, letterSpacing: '-0.01em'}}>Concept Breakdown</h3>
          <p style={{fontSize: 14, color: 'var(--text-3)', lineHeight: 1.7}}>AI explains high-frequency exam concepts in a simple and clear way.</p>
        </div>
        <div className="step-card" style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 28px', boxShadow: 'var(--shadow-card)', overflow: 'hidden'}}>
          <div className="step-num" style={{fontSize: 13, fontWeight: 700, color: 'var(--red)', letterSpacing: 0.5, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8}}>
            Step 2 <span style={{flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(255,99,99,0.3), transparent)'}}></span>
          </div>
          <h3 style={{fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 10, letterSpacing: '-0.01em'}}>Mistake Analysis</h3>
          <p style={{fontSize: 14, color: 'var(--text-3)', lineHeight: 1.7}}>AI finds the cause behind wrong answers so you identify weak spots faster.</p>
        </div>
        <div className="step-card" style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 28px', boxShadow: 'var(--shadow-card)', overflow: 'hidden'}}>
          <div className="step-num" style={{fontSize: 13, fontWeight: 700, color: 'var(--red)', letterSpacing: 0.5, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8}}>
            Step 3 <span style={{flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(255,99,99,0.3), transparent)'}}></span>
          </div>
          <h3 style={{fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 10, letterSpacing: '-0.01em'}}>Exam Readiness</h3>
          <p style={{fontSize: 14, color: 'var(--text-3)', lineHeight: 1.7}}>Build real test confidence with questions similar to the actual exam.</p>
        </div>
      </div>
    </section>
  );
}
