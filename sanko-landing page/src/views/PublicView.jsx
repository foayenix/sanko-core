import { useEffect, useState } from 'react';
import { COLORS } from '../data';

export default function PublicView() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return undefined;

    const timeoutId = setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => clearTimeout(timeoutId);
  }, [toast]);

  return (
    <div className="view-light view-public public-shell" style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'inline-block', padding: '5px 12px', borderRadius: 999, background: 'rgba(184,134,11,0.12)', border: '1px solid rgba(184,134,11,0.24)', color: COLORS.gold, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          Open data
        </div>
        <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', serif", fontSize: 28, color: 'rgba(255,255,255,0.92)' }}>The state of African traditional medicine</h2>
        <div style={{ margin: '8px auto 0', maxWidth: 520, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
          Population-level data from the Sanko platform. No individual practitioners, formulations, or patients identified. Updated monthly.
        </div>
      </div>

      <div className="public-kpis" style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, textAlign: 'center' }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 32, color: COLORS.forest }}>12,300</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Practitioners</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.32)' }}>Tier 1 active deployment</div></div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 32 }}>35,600</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Formulations</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.32)' }}>Across 3 active countries</div></div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 32, color: '#4ADE80' }}>141,000</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Patient outcomes</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.32)' }}>Patient-reported and linked</div></div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 32, color: COLORS.gold }}>3 active</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Countries</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.32)' }}>6+ targeted</div></div>
      </div>

      <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--muted)', fontStyle: 'italic' }}>
        Patient-reported outcomes. Documentation signal, not clinical efficacy.
      </div>

      <section className="public-country-section" style={{ marginTop: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Tier 1 — Active deployment (by 2028)</div>
        <div className="public-tier1-head" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.5fr 1.8fr', gap: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          <div>Country</div><div>Practitioners</div><div>Formulations</div><div>Outcomes</div><div>Languages</div><div>Status</div>
        </div>

        {[{
          country: 'Nigeria', practitioners: '8,400', formulations: '24,000', outcomes: '96,000', languages: 'Yoruba, Igbo, Hausa, Pidgin', status: 'Pilot 2026 · National rollout 2027',
        }, {
          country: 'Ghana', practitioners: '2,100', formulations: '6,200', outcomes: '24,000', languages: 'Twi, Ga, English', status: 'Targeted 2027',
        }, {
          country: 'Kenya', practitioners: '1,800', formulations: '5,400', outcomes: '21,000', languages: 'Kiswahili, English', status: 'Targeted 2028',
        }].map((row) => (
          <div key={row.country} className="public-tier1-row" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.5fr 1.8fr', gap: 8, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>
            <div>{row.country}</div>
            <div>{row.practitioners}</div>
            <div>{row.formulations}</div>
            <div>{row.outcomes}</div>
            <div style={{ color: 'rgba(255,255,255,0.48)' }}>{row.languages}</div>
            <div>{row.status}</div>
          </div>
        ))}

        <div style={{ marginTop: 14, marginBottom: 8, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Tier 2 — Targeted expansion (by 2030)</div>
        <div className="public-tier2-head" style={{ display: 'grid', gridTemplateColumns: '1.4fr 2.6fr', gap: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          <div>Country</div><div>Status</div>
        </div>
        {[{
          country: 'South Africa', status: 'Aspirational 2029 — pending federation partnership',
        }, {
          country: 'Uganda', status: 'Aspirational 2029 — pending federation partnership',
        }, {
          country: '+ 4 more East/West African countries', status: 'Subject to funding and partnership',
        }].map((row) => (
          <div key={row.country} className="public-tier2-row" style={{ display: 'grid', gridTemplateColumns: '1.4fr 2.6fr', gap: 8, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>
            <div>{row.country}</div>
            <div>{row.status}</div>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 14, border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--bg-alt)', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--gold)', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>0X</span>
          <h3 style={{ margin: 0, fontFamily: "'Manrope', sans-serif", fontSize: 22, color: 'var(--ink)' }}>Tiered access and benefit-sharing</h3>
        </div>

        <div className="tier-table">
          <div className="tier-header">Tier</div>
          <div className="tier-header">What the user sees</div>
          <div className="tier-header">What flows to practitioners</div>

          <div className="tier-cell tier-name">Public</div>
          <div className="tier-cell">Continental and country-level aggregate trends. Botanical species names. Condition prevalence.</div>
          <div className="tier-cell">None — public benefit only</div>

          <div className="tier-cell tier-name">Research</div>
          <div className="tier-cell">Anonymised compound-level data with research readiness scores. Practitioner consent required per query.</div>
          <div className="tier-cell">Co-authorship on publications; access to outcome data</div>

          <div className="tier-cell tier-name">Commercial</div>
          <div className="tier-cell">Full records under scoped Nagoya ABS agreements. Provenance maintained throughout.</div>
          <div className="tier-cell">Minimum 50% of licensing revenue, distributed via Sanko Foundation</div>
        </div>

        <div style={{ marginTop: 10, fontFamily: "'Manrope', sans-serif", fontStyle: 'italic', color: 'var(--muted)', fontSize: 14 }}>
          This is what distinguishes Sanko from open-data platforms. Knowledge flows out; value flows back.
        </div>

        <style>{`
          .tier-table {
            display: grid;
            grid-template-columns: 0.9fr 2fr 2fr;
            border-top: 1px solid var(--rule);
            border-left: 1px solid var(--rule);
          }

          .tier-header {
            border-right: 1px solid var(--rule);
            border-bottom: 1px solid var(--rule);
            padding: 8px;
            font-size: 12px;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            color: var(--muted);
            font-weight: 700;
          }

          .tier-cell {
            border-right: 1px solid var(--rule);
            border-bottom: 1px solid var(--rule);
            padding: 10px 8px;
            font-size: 13px;
            line-height: 1.6;
            color: var(--ink-soft);
          }

          .tier-name {
            font-family: 'Manrope', sans-serif;
            font-size: 18px;
            color: var(--ink);
          }

          @media (max-width: 900px) {
            .tier-table {
              grid-template-columns: 1fr;
              border-left: none;
              border-top: none;
            }

            .tier-header {
              border-left: 1px solid var(--rule);
            }

            .tier-cell {
              border-left: 1px solid var(--rule);
            }
          }
        `}</style>
      </section>

      <div className="public-insights" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ borderLeft: `3px solid ${COLORS.forest}`, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>Across 12,000 documented malaria/fever cases (across Tier 1 countries), practitioners reported <strong>82% patient-reported improvement</strong> within 5 days.</div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Based on patient-reported outcomes via WhatsApp and SMS follow-up</div>
        </div>

        <div style={{ borderLeft: `3px solid ${COLORS.gold}`, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}><strong>9 formulations</strong> have crossed 120+ documented patient-reported outcomes with reported improvement above 80% and adverse event rates below 5% — research candidates for formal pharmacological investigation.</div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Research readiness scores available to approved research institutions</div>
        </div>

        <div style={{ borderLeft: '3px solid #2D4B8E', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}><strong>2,100+ unique botanical species</strong> documented with local-to-Latin name mappings across 28 languages — the most comprehensive African medicinal plant nomenclature database ever assembled.</div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Contributed by practitioners across Tier 1 countries with planned regional expansion</div>
        </div>
      </div>

      <div className="public-report-card" style={{ marginTop: 14, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 12, textAlign: 'center', padding: 20 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 20, color: 'rgba(255,255,255,0.9)' }}>Annual report: The state of African traditional medicine 2030</div>
        <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
          The population-level data WHO has been asking for since 2002 — produced by practitioners, for the first time.
        </div>
        <button
          type="button"
          onClick={() => setToast('Demo — report not available in preview')}
          style={{ marginTop: 12, borderRadius: 8, padding: '10px 16px', background: COLORS.forest, border: `1px solid ${COLORS.forest}`, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          Download PDF report →
        </button>
      </div>

      <div className="public-flow-strip" style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 16, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Practitioners</span>
        <span style={{ color: 'rgba(27,107,58,0.6)' }}>→</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Outcome data</span>
        <span style={{ color: 'rgba(184,134,11,0.6)' }}>→</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Research</span>
        <span style={{ color: 'rgba(45,75,142,0.7)' }}>→</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Documented formulations</span>
        <span style={{ color: 'rgba(255,255,255,0.28)' }}>→</span>
        <span style={{ color: 'rgba(255,255,255,0.55)' }}>↩ cycle accelerates</span>
      </div>

      <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', transition: 'all 0.2s ease', opacity: toast ? 1 : 0, pointerEvents: 'none' }}>
        <div style={{ background: 'var(--bg-alt)', border: '1px solid var(--rule)', borderRadius: 999, padding: '8px 14px', fontSize: 13, color: 'var(--ink-soft)' }}>
          {toast || ''}
        </div>
      </div>
    </div>
  );
}
