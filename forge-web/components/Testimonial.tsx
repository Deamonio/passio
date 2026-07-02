export function Testimonial() {
  return (
    <section className="testimonial-section" style={{padding: '80px 48px', maxWidth: 1160, margin: '0 auto'}}>
      <div className="section-header" style={{marginBottom: 56}}>
        <div className="section-kicker" style={{display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, color: 'var(--red)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 16}}>
          <span style={{display: 'inline-block', width: 16, height: 1, background: 'var(--red)'}}></span>
          Success Stories
        </div>
        <h2 className="section-title" style={{fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 500, color: 'var(--text)', lineHeight: 1.18, letterSpacing: '-0.015em'}}>Stories from<br />real passers</h2>
      </div>
      <div className="testimonial-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16}}>
        {/* Testimonial card 1 */}
        <div className="testimonial-card" style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow-card)', position: 'relative', transition: 'border-color 0.2s'}}>
          <div className="tcard-badge" style={{position: 'absolute', top: 20, right: 20, background: 'var(--green-dim)', border: '1px solid rgba(95,201,146,0.2)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: 0.3}}>Passed</div>
          <div className="tcard-stars" style={{display: 'flex', gap: 2, marginBottom: 14}}>
            {Array(5).fill(0).map((_, i) => <span key={i} className="tcard-star" style={{color: 'var(--yellow)', fontSize: 13}}>★</span>)}
          </div>
          <p className="tcard-text" style={{fontSize: 14, color: 'var(--text-2)', lineHeight: 1.75, marginBottom: 20, fontStyle: 'italic'}}>
            I failed Engineer Information Processing three times. After studying with VeriTutor, I finally passed. AI showed my error patterns and made my focus crystal clear.
          </p>
          <div className="tcard-author" style={{display: 'flex', alignItems: 'center', gap: 10}}>
            <div className="tcard-avatar" style={{width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#3a6dff,#7c9fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white', flexShrink: 0}}>K</div>
            <div>
              <div className="tcard-name" style={{fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 1}}>Jaewon Kim</div>
              <div className="tcard-cert" style={{fontSize: 12, color: 'var(--text-4)'}}>Engineer Information Processing · 2024.11</div>
            </div>
          </div>
        </div>
        {/* Testimonial card 2 */}
        <div className="testimonial-card" style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow-card)', position: 'relative', transition: 'border-color 0.2s'}}>
          <div className="tcard-badge" style={{position: 'absolute', top: 20, right: 20, background: 'var(--green-dim)', border: '1px solid rgba(95,201,146,0.2)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: 0.3}}>Passed</div>
          <div className="tcard-stars" style={{display: 'flex', gap: 2, marginBottom: 14}}>
            {Array(5).fill(0).map((_, i) => <span key={i} className="tcard-star" style={{color: 'var(--yellow)', fontSize: 13}}>★</span>)}
          </div>
          <p className="tcard-text" style={{fontSize: 14, color: 'var(--text-2)', lineHeight: 1.75, marginBottom: 20, fontStyle: 'italic'}}>
            I loved being able to ask difficult concepts even late at night. I passed AWS SAA in about six weeks, with explanations much clearer than textbooks.
          </p>
          <div className="tcard-author" style={{display: 'flex', alignItems: 'center', gap: 10}}>
            <div className="tcard-avatar" style={{width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#2ecc71,#7defa1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white', flexShrink: 0}}>L</div>
            <div>
              <div className="tcard-name" style={{fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 1}}>Seoyeon Lee</div>
              <div className="tcard-cert" style={{fontSize: 12, color: 'var(--text-4)'}}>AWS SAA · 2025.01</div>
            </div>
          </div>
        </div>
        {/* Testimonial card 3 */}
        <div className="testimonial-card" style={{background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, boxShadow: 'var(--shadow-card)', position: 'relative', transition: 'border-color 0.2s'}}>
          <div className="tcard-badge" style={{position: 'absolute', top: 20, right: 20, background: 'var(--green-dim)', border: '1px solid rgba(95,201,146,0.2)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: 0.3}}>Passed</div>
          <div className="tcard-stars" style={{display: 'flex', gap: 2, marginBottom: 14}}>
            {Array(5).fill(0).map((_, i) => <span key={i} className="tcard-star" style={{color: 'var(--yellow)', fontSize: 13}}>★</span>)}
          </div>
          <p className="tcard-text" style={{fontSize: 14, color: 'var(--text-2)', lineHeight: 1.75, marginBottom: 20, fontStyle: 'italic'}}>
            When preparing for SQLD, I lacked SQL basics. The step-by-step explanations helped a lot and felt completely different from pure memorization.
          </p>
          <div className="tcard-author" style={{display: 'flex', alignItems: 'center', gap: 10}}>
            <div className="tcard-avatar" style={{width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#e67e22,#f5a55a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white', flexShrink: 0}}>P</div>
            <div>
              <div className="tcard-name" style={{fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 1}}>Minjun Park</div>
              <div className="tcard-cert" style={{fontSize: 12, color: 'var(--text-4)'}}>SQLD · 2025.02</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
