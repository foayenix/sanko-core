import { useEffect, useState } from 'react';
import { COLORS } from './data';
import HomeView from './views/HomeView';
import PractitionerView from './views/PractitionerView';
import ResearcherView from './views/ResearcherView';
import RegulatorView from './views/RegulatorView';
import PublicView from './views/PublicView';

const VISION_CONTEXT_STORAGE_KEY = 'sanko_vision_context_seen';

const VIEWS = [
  { id: 'home', label: 'Home' },
  { id: 'pract', label: 'Practitioner' },
  { id: 'research', label: 'Researcher' },
  { id: 'regulator', label: 'Regulator' },
  { id: 'public', label: 'Public data' },
];

export default function App() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shouldStayInDemo = params.get('demo') === '1';

    if (window.location.pathname === '/' && !shouldStayInDemo) {
      window.location.replace('/landing/');
    }
  }, []);

  const [view, setView] = useState('home');
  const [showVisionContext, setShowVisionContext] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(VISION_CONTEXT_STORAGE_KEY) !== 'true';
  });

  const dismissVisionContext = () => {
    setShowVisionContext(false);
    window.localStorage.setItem(VISION_CONTEXT_STORAGE_KEY, 'true');
  };

  const reopenVisionContext = () => {
    setView('home');
    setShowVisionContext(true);
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  return (
    <div className="sanko-app" style={{ minHeight: '100vh' }}>
      {/* Sticky nav */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--bg)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--rule-soft)',
        padding: '12px 0',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <a
            href="/landing/"
            aria-label="Go to Sanko landing page"
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8, textDecoration: 'none' }}
          >
            <span style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img
                src="/sanko-mark.svg"
                alt="Sanko source mark"
                style={{ height: 40, width: 40, display: 'block', padding: 5, background: '#17134f' }}
              />
            </span>
            <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1, color: '#142338', lineHeight: 1, fontFamily: "'Manrope', sans-serif" }}>
              Sanko
            </span>
          </a>
          <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500, letterSpacing: 1, textTransform: 'uppercase' }}>Experience as:</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {VIEWS.map(v => (
              <button key={v.id} onClick={() => setView(v.id)} style={{
                padding: '8px 16px', borderRadius: 99, fontSize: 14, fontWeight: 600,
                color: view === v.id ? 'var(--bg)' : 'var(--ink-soft)',
                background: view === v.id ? COLORS.forest : 'transparent',
                border: view === v.id ? `1px solid ${COLORS.forest}` : '1px solid var(--rule)',
                cursor: 'pointer', fontFamily: "'Manrope', sans-serif",
                display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
              }}>
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reopenVisionContext}
            style={{
              marginLeft: 'auto',
              border: 'none',
              borderBottom: '1px solid var(--ink-soft)',
              background: 'transparent',
              color: 'var(--ink-soft)',
              fontSize: 13,
              letterSpacing: 0.4,
              cursor: 'pointer',
              padding: 0,
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            About this demonstration
          </button>
        </div>
      </nav>

      {/* View content */}
      <main>
        {view === 'home' && (
          <HomeView
            onNavigate={setView}
            showVisionContext={showVisionContext}
            onContinueVisionContext={dismissVisionContext}
            onDismissVisionContext={dismissVisionContext}
          />
        )}
        {view === 'pract' && <PractitionerView />}
        {view === 'research' && <ResearcherView />}
        {view === 'regulator' && <RegulatorView />}
        {view === 'public' && <PublicView />}
      </main>
    </div>
  );
}
