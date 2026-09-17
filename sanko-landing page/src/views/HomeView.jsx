import { COLORS } from '../data';
import VisionContext from '../components/VisionContext';

const phases = [
  { date: 'TODAY', color: '#1B6B3A', title: 'Vault MVP in development', desc: 'Voice + photo documentation\nYemkem clinic as pilot site\nHTSN network' },
  { date: 'JUNE 2027', color: '#2D4B8E', title: 'Practitioner validation', desc: '100 practitioners onboarded\nNigeria validation complete\nGrant applications underway' },
  { date: 'JUNE 2028', color: '#7F77DD', title: 'Evidence pilot', desc: 'Outcome tracking live at Yemkem\nUniversity partnerships\nProduct hardening' },
  { date: '2030+', color: '#D85A30', title: 'Pan-African platform', desc: '3 countries active · 6+ targeted\nWHO engagement\nWhat you\'re about to see ↓' },
];

const flywheelNodes = [
  { label: 'More practitioners', sub: 'document formulations', color: COLORS.forest },
  { label: 'More outcome data', sub: 'linked to formulations', color: COLORS.gold },
  { label: 'Research interest', sub: 'universities + pharma', color: COLORS.indigo },
  { label: 'Documented formulations', sub: 'credibility + trust', color: '#7F77DD' },
];

const roleCards = [
  { id: 'pract', title: 'Practitioner', desc: 'Vault for formulation documentation, voice capture, outcome tracking, community view, and research interest notifications.' },
  { id: 'research', title: 'Researcher', desc: 'Search anonymised formulations, explore compound frequency, request Nagoya-compliant collaboration.' },
  { id: 'regulator', title: 'Regulator', desc: 'Population-level intelligence, pharmacovigilance signals, formulations of regulatory interest.' },
  { id: 'public', title: 'Public data portal', desc: 'Aggregate numbers across 3 active countries with 6+ targeted, key evidence findings, annual state of African TM report.' },
];

export default function HomeView({
  onNavigate,
  showVisionContext,
  onContinueVisionContext,
  onDismissVisionContext,
}) {
  return (
    <div className="view-light view-home home-shell" style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
      <VisionContext
        visible={showVisionContext}
        onContinue={onContinueVisionContext}
        onDismiss={onDismissVisionContext}
      />

      {/* Eyebrow */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <span style={{
          color: 'var(--muted)',
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: 1,
          fontFamily: "'Manrope', sans-serif",
          fontVariant: 'all-small-caps',
        }}>Vision demo · Sanko 2030</span>
      </div>

      {/* Section A: Journey Timeline */}
      <div className="home-timeline" style={{ marginBottom: 48 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{ color: COLORS.gold, textTransform: 'uppercase', fontSize: 28, fontWeight: 500, letterSpacing: 0.3, fontFamily: "'Source Serif 4', serif" }}>
            The journey — from today to what you're about to see
          </span>
        </div>
        <div className="home-timeline-track" style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', gap: 12, paddingBottom: 12 }}>
          {/* Connector line */}
          <div style={{
            position: 'absolute', left: 12, right: 12, bottom: 0, height: 1,
            background: 'var(--rule)',
            zIndex: 0,
          }} />
          {phases.map((p, i) => (
            <div key={i} className="home-timeline-item" style={{ flex: 1, textAlign: 'center', position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase', fontFamily: "'Manrope', sans-serif", fontVariant: 'all-small-caps' }}>{p.date}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--ink)', marginBottom: 8, fontFamily: "'Source Serif 4', serif" }}>{p.title}</div>
              <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-line', fontFamily: "'Manrope', sans-serif", fontWeight: 400 }}>{p.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section B: Data Flywheel */}
      <div className="home-flywheel" style={{
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14, padding: 24, marginBottom: 48,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ color: COLORS.forest, textTransform: 'uppercase', fontSize: 28, fontWeight: 500, letterSpacing: 0.3, fontFamily: "'Source Serif 4', serif" }}>
            Why this compounds — the data flywheel
          </span>
        </div>
        <div className="home-flywheel-grid" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 16 }}>
          {flywheelNodes.map((n, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>{n.label}</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>{n.sub}</div>
              {i < 3 && <div style={{ position: 'absolute', display: 'none' }}>→</div>}
            </div>
          ))}
        </div>
        <div style={{
          textAlign: 'center', padding: '8px 16px', borderRadius: 99,
          background: 'rgba(27,107,58,0.06)', border: '1px solid rgba(27,107,58,0.1)',
          fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 16,
        }}>
          ↩ Documented formulations attract <strong style={{ color: 'rgba(255,255,255,0.7)' }}>more practitioners</strong> — the cycle accelerates
        </div>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, textAlign: 'center' }}>
          Each practitioner who joins makes the platform more valuable for every other practitioner, researcher, and regulator. This is why Sanko compounds — and why no one can replicate the dataset once it reaches scale.
        </p>
      </div>

      {/* Section C: Role Selector */}
      <div className="home-role-selector">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', fontSize: 28, fontWeight: 500, letterSpacing: 0.3, fontFamily: "'Source Serif 4', serif" }}>
            Experience the 2030 platform
          </span>
        </div>
        <div className="home-role-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {roleCards.map(c => (
            <div
              key={c.id}
              onClick={() => onNavigate(c.id)}
              style={{
                padding: 20, borderRadius: 12, cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.forest; e.currentTarget.style.background = 'rgba(27,107,58,0.04)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            >
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, color: 'rgba(255,255,255,0.85)' }}>{c.title}</div>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>{c.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
