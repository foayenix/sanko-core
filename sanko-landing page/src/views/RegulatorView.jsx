import { useState } from 'react';
import { CITIES, COLORS, FORMULATIONS, SAFETY_SIGNALS } from '../data';

const CONDITION_DATA = [
  { label: 'Malaria/Fever', percent: 32, cases: '59,520' },
  { label: 'Diabetes', percent: 18, cases: '33,480' },
  { label: 'Cough/Respiratory', percent: 14, cases: '26,040' },
  { label: 'Hypertension', percent: 11, cases: '20,460' },
  { label: 'Digestive', percent: 8, cases: '14,880' },
  { label: 'Pain', percent: 6, cases: '11,160' },
  { label: 'Other', percent: 11, cases: '20,460' },
];

function getOutcomeSegments(outcomes) {
  return [
    { key: 'recovered', color: COLORS.forest, value: outcomes.recovered },
    { key: 'improved', color: '#4ADE80', value: outcomes.improved },
    { key: 'noChange', color: COLORS.gold, value: outcomes.noChange },
    { key: 'worsened', color: COLORS.terra, value: outcomes.worsened },
  ];
}

export default function RegulatorView() {
  const [selectedCity, setSelectedCity] = useState(null);
  const [expandedSignal, setExpandedSignal] = useState(null);
  const [expandedFormulation, setExpandedFormulation] = useState(null);
  const [hoveredBar, setHoveredBar] = useState(null);

  const interestFormulations = FORMULATIONS.filter((item) => item.effectiveness >= 80);

  return (
    <div className="view-light view-regulator regulator-shell" style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <style>{`
        @keyframes cityPulse {
          from { transform: scale(1); opacity: 0.85; }
          to { transform: scale(1.12); opacity: 1; }
        }
      `}</style>

      <div style={{ display: 'inline-block', padding: '5px 12px', borderRadius: 999, background: 'rgba(184,134,11,0.12)', border: '1px solid rgba(184,134,11,0.24)', color: COLORS.gold, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
        Sanko Governance Dashboard
      </div>
      <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', serif", fontSize: 24, color: 'rgba(255,255,255,0.92)' }}>Traditional medicine — population-level intelligence</h2>
      <div style={{ marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>
        Real-time data on traditional medicine usage, outcomes, and safety signals across Nigeria.
      </div>

      <div className="regulator-kpis" style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24, color: COLORS.forest }}>12,400</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Active practitioners</div></div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24 }}>54,200</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Formulations documented</div></div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24 }}>186,000</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Patient outcomes tracked</div></div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24, color: COLORS.forest }}>82%</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>National patient-reported improvement (n=186,000)</div></div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24, color: '#F87171' }}>3</div><div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Active safety signals</div></div>
      </div>

      <div className="regulator-top-grid" style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 12 }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>Usage density by state</div>
          <div style={{ position: 'relative', height: 200, borderRadius: 10, background: 'radial-gradient(circle at 30% 30%, rgba(27,107,58,0.18), rgba(27,107,58,0.04) 60%, rgba(255,255,255,0.02) 100%)', border: '1px solid rgba(27,107,58,0.14)' }}>
            {CITIES.map((city) => {
              const active = selectedCity?.name === city.name;
              return (
                <button
                  key={city.name}
                  type="button"
                  onClick={() => setSelectedCity(city)}
                  style={{
                    position: 'absolute',
                    left: `${city.x}%`,
                    top: `${city.y}%`,
                    transform: 'translate(-50%, -50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>{city.name}</div>
                  <div style={{ width: active ? 14 : 10, height: active ? 14 : 10, borderRadius: '50%', background: active ? '#4ADE80' : COLORS.forest, boxShadow: active ? '0 0 14px rgba(74,222,128,0.85)' : '0 0 10px rgba(27,107,58,0.65)', animation: 'cityPulse 1.4s infinite alternate' }} />
                </button>
              );
            })}
          </div>

          {selectedCity && (
            <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{selectedCity.name}</div>
                <button type="button" onClick={() => setSelectedCity(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 }}>Close ×</button>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                {selectedCity.practitioners.toLocaleString()} practitioners · {selectedCity.formulations.toLocaleString()} formulations
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedCity.conditions.map((condition) => (
                  <span key={condition} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: 'rgba(27,107,58,0.12)', color: '#4ADE80' }}>{condition}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, position: 'relative' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>Top conditions treated</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minHeight: 170 }}>
            {CONDITION_DATA.map((item, index) => (
              <div
                key={item.label}
                onMouseEnter={() => setHoveredBar(item.label)}
                onMouseLeave={() => setHoveredBar(null)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }}
              >
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{item.percent}%</div>
                <div style={{ width: '100%', maxWidth: 34, borderRadius: '4px 4px 0 0', background: `rgba(27,107,58,${0.85 - index * 0.08})`, height: `${(item.percent / 32) * 120}px` }} />
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>{item.label}</div>
              </div>
            ))}
          </div>

          {hoveredBar && (
            <div style={{ position: 'absolute', right: 10, top: 10, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-alt)', border: '1px solid var(--rule)', fontSize: 12, color: 'var(--ink-soft)' }}>
              {(() => {
                const item = CONDITION_DATA.find((entry) => entry.label === hoveredBar);
                return `${item.label}: ${item.percent}% · ${item.cases} tracked cases`;
              })()}
            </div>
          )}
        </div>
      </div>

      <div className="regulator-interest" style={{ marginTop: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#F87171' }}>Active pharmacovigilance signals</div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Auto-detected from outcome data</div>
        <div style={{ marginTop: -2, marginBottom: 10, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--muted)', fontStyle: 'italic' }}>
          Patient-reported outcomes. Documentation signal, not clinical efficacy.
        </div>

        {SAFETY_SIGNALS.map((signal) => {
          const expanded = expandedSignal === signal.id;
          const severityColor = signal.severity === 'Moderate' ? '#FCD34D' : 'rgba(255,255,255,0.7)';
          const severityBg = signal.severity === 'Moderate' ? 'rgba(184,134,11,0.18)' : 'rgba(255,255,255,0.1)';
          const statusBlue = signal.status === 'Under review' || signal.status === 'Investigating';
          return (
            <button
              key={signal.id}
              type="button"
              onClick={() => setExpandedSignal((prev) => (prev === signal.id ? null : signal.id))}
              style={{ width: '100%', background: 'rgba(255,255,255,0.02)', border: expanded ? `1px solid ${COLORS.terra}` : '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12, textAlign: 'left', marginBottom: 8, cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{signal.title}</div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{signal.region}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{signal.reports} reports</span>
                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: severityBg, color: severityColor }}>{signal.severity}</span>
                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: statusBlue ? 'rgba(45,75,142,0.2)' : 'rgba(255,255,255,0.1)', color: statusBlue ? '#60A5FA' : 'rgba(255,255,255,0.65)' }}>{signal.status}</span>
              </div>

              {expanded && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.56)', marginBottom: 8 }}>{signal.detail}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>Ingredients involved:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {signal.ingredients.map((ingredient) => (
                      <span key={ingredient} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, background: 'rgba(158,74,47,0.14)', color: '#FCA5A5' }}>{ingredient}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Timeline: <span style={{ color: 'rgba(255,255,255,0.68)' }}>{signal.timeline}</span></div>
                  <div style={{ marginTop: 3, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Recommended action: <span style={{ color: 'rgba(255,255,255,0.68)' }}>{signal.action}</span></div>
                </div>
              )}
            </button>
          );
        })}

        <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
          Signals generated when 3+ independent practitioners report similar adverse events for formulations sharing common ingredients. No individual practitioner or patient identified.
        </div>
      </div>

      <div style={{ marginTop: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.75)' }}>Formulations of regulatory interest</div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Crossed statistical thresholds for evidence-based registration</div>

        <div className="regulator-interest-head" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 1fr', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          <div>ID</div><div>Condition</div><div>Outcomes</div><div>Reported improvement</div><div>Side effects</div><div>Readiness</div>
        </div>

        {interestFormulations.map((formulation) => {
          const expanded = expandedFormulation === formulation.id;
          return (
            <div key={formulation.id}>
              <button
                type="button"
                onClick={() => setExpandedFormulation((prev) => (prev === formulation.id ? null : formulation.id))}
                className="regulator-interest-row"
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 13, fontFamily: "'Manrope', sans-serif" }}
              >
                <div>{formulation.anonId}</div>
                <div>{formulation.conditions[0]}</div>
                <div>{formulation.tracked}</div>
                <div>{formulation.effectiveness}% (n={formulation.tracked})</div>
                <div>{formulation.sideEffects.count}</div>
                <div style={{ color: formulation.effectiveness >= 80 ? '#4ADE80' : '#FCD34D' }}>{formulation.effectiveness >= 80 ? 'High' : 'Medium'}</div>
              </button>

              {expanded && (
                <div style={{ margin: '0 0 10px', padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
                    Ingredients: {formulation.ingredients.map((item) => item.botanical).join(', ')}
                  </div>
                  <div style={{ display: 'flex', gap: 2, height: 18, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                    {getOutcomeSegments(formulation.outcomes).map((segment) => (
                      <div key={segment.key} style={{ width: `${segment.value}%`, background: segment.color }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.56)', marginBottom: 4 }}>Geographic distribution: primarily Southwest Nigeria</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.56)' }}>
                    This formulation meets the evidence threshold for expanded registration review under the proposed traditional medicine regulatory pathway.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="regulator-flow-strip" style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 16, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
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
    </div>
  );
}
