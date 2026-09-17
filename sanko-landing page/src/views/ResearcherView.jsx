import { useMemo, useState } from 'react';
import { COLORS, COMPOUNDS, FORMULATIONS } from '../data';
import EOSMPanel from '../components/EOSMPanel';

function getPreparationType(preparation) {
  const normalized = preparation.toLowerCase();
  if (normalized.includes('boil')) return 'Decoction';
  if (normalized.includes('grind')) return 'Powder';
  if (normalized.includes('soak')) return 'Maceration';
  return 'Mixed';
}

function getOutcomeSegments(outcomes) {
  return [
    { key: 'recovered', label: 'Recovered', color: COLORS.forest, value: outcomes.recovered },
    { key: 'improved', label: 'Improved', color: '#4ADE80', value: outcomes.improved },
    { key: 'noChange', label: 'No change', color: COLORS.gold, value: outcomes.noChange },
    { key: 'worsened', label: 'Worsened', color: COLORS.terra, value: outcomes.worsened },
  ];
}

function getReadiness(effectiveness) {
  if (effectiveness >= 80) return { label: 'High', color: '#4ADE80', bg: 'rgba(27,107,58,0.16)' };
  if (effectiveness >= 60) return { label: 'Medium', color: '#FCD34D', bg: 'rgba(184,134,11,0.16)' };
  return { label: 'Low', color: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.1)' };
}

function filterFormulations(search) {
  const words = search
    .toLowerCase()
    .split(/[\s,]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (!words.length) return FORMULATIONS;

  return FORMULATIONS.filter((formulation) => {
    const haystack = [
      formulation.name,
      ...formulation.conditions,
      ...formulation.ingredients.flatMap((ingredient) => [ingredient.local, ingredient.english, ingredient.botanical]),
    ]
      .join(' ')
      .toLowerCase();

    return words.some((word) => haystack.includes(word));
  });
}

const ACCESS_TIERS = [
  {
    id: 'research',
    label: 'Research tier (free)',
    price: '£0',
    terms:
      'Anonymised aggregate data. No commercial use. No publication of identified compounds without separate consent. Benefit-sharing: practitioner co-authorship on resulting publications.',
  },
  {
    id: 'pre-commercial',
    label: 'Pre-commercial tier (£5,000)',
    price: '£5,000',
    terms:
      'Compound-level data with provenance metadata. Publication permitted with practitioner co-authorship. Benefit-sharing: 30% of any downstream commercial licensing returned to practitioner via Sanko Foundation.',
  },
  {
    id: 'commercial',
    label: 'Commercial tier (£25,000+, scoped)',
    price: '£25,000+',
    terms:
      'Full record access for licensed commercial development. Nagoya Protocol ABS agreement required. Benefit-sharing: scoped per agreement, minimum 50% to practitioner via Sanko Foundation.',
  },
];

function CollaborationModal({ step, selectedTier, onSelectTier, onClose, onNext, onBack, onSend, isSent }) {

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,27,42,0.22)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 760, background: 'var(--bg-alt)', border: '1px solid var(--ink)', borderRadius: 4, padding: 20 }}>
        {!isSent && step === 1 && (
          <>
            <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
              Step 1 of 3 · Practitioner consent
            </div>
            <h3 style={{ margin: 0, fontFamily: "'Manrope', sans-serif", fontSize: 22, color: 'var(--ink)', marginBottom: 8 }}>Practitioner consent required</h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-soft)', marginBottom: 12 }}>
              This formulation was contributed by an anonymised practitioner in [Lagos State, Nigeria]. Researcher access requires their explicit consent. They will receive a WhatsApp message describing your research interest, your institution, and the proposed use.
            </div>

            <div style={{ border: '1px solid var(--rule)', background: 'var(--bg)', borderRadius: 4, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>
                Sanko consent request
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-soft)' }}>
                Dr. Adaeze Okafor (University of Ibadan) is interested in your formulation F-00482 for clinical signal review. No reproduction or commercial use. Your identity remains anonymous. Reply YES to consent, NO to decline, or INFO to learn more.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" onClick={onClose} style={{ border: 'none', borderBottom: '1px solid var(--ink-soft)', background: 'transparent', color: 'var(--ink-soft)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: "'Manrope', sans-serif" }}>Close</button>
              <button type="button" onClick={onNext} style={{ borderRadius: 4, padding: '9px 14px', background: 'var(--bg)', border: '1px solid var(--ink)', color: 'var(--ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}>Next →</button>
            </div>
          </>
        )}

        {!isSent && step === 2 && (
          <>
            <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
              Step 2 of 3 · Access tier and benefit-sharing
            </div>
            <h3 style={{ margin: 0, fontFamily: "'Manrope', sans-serif", fontSize: 22, color: 'var(--ink)', marginBottom: 10 }}>Access tier and benefit-sharing</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {ACCESS_TIERS.map((tier) => {
                const active = selectedTier === tier.id;

                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => onSelectTier(tier.id)}
                    style={{
                      width: '100%',
                      border: '1px solid var(--rule)',
                      borderRadius: 4,
                      background: 'var(--bg)',
                      padding: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: "'Manrope', sans-serif",
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10, alignItems: 'start' }}>
                      <span style={{ width: 16, height: 16, border: '1px solid var(--rule)', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: active ? 'var(--ink)' : 'transparent' }} />
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--ink)' }}>{tier.label}</span>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 20, color: 'var(--ink)' }}>{tier.price}</span>
                    </div>
                    <div style={{ marginTop: 8, marginLeft: 34, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{tier.terms}</div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" onClick={onBack} style={{ border: 'none', borderBottom: '1px solid var(--ink-soft)', background: 'transparent', color: 'var(--ink-soft)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: "'Manrope', sans-serif" }}>Back</button>
              <button type="button" onClick={onNext} style={{ borderRadius: 4, padding: '9px 14px', background: 'var(--bg)', border: '1px solid var(--ink)', color: 'var(--ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}>Next →</button>
            </div>
          </>
        )}

        {!isSent && step === 3 && (
          <>
            <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
              Step 3 of 3 · ABS agreement
            </div>
            <h3 style={{ margin: 0, fontFamily: "'Manrope', sans-serif", fontSize: 22, color: 'var(--ink)', marginBottom: 10 }}>ABS agreement</h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-soft)', marginBottom: 14 }}>
              Your selected access tier will generate an ABS-compliant agreement under the Nagoya Protocol. The agreement will be co-signed by you, the practitioner (via consent), and Sanko as data custodian. Estimated turnaround: 72 hours for research tier; 2 weeks for commercial.
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" onClick={onBack} style={{ border: 'none', borderBottom: '1px solid var(--ink-soft)', background: 'transparent', color: 'var(--ink-soft)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: "'Manrope', sans-serif" }}>Back</button>
              <button type="button" onClick={onSend} style={{ borderRadius: 4, padding: '9px 14px', background: 'var(--bg)', border: '1px solid var(--ink)', color: 'var(--ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}>Send consent request → [Practitioner]</button>
            </div>
          </>
        )}

        {isSent && (
          <>
            <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
              Request status
            </div>
            <h3 style={{ margin: 0, fontFamily: "'Manrope', sans-serif", fontSize: 22, color: 'var(--ink)', marginBottom: 8 }}>Request sent</h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-soft)', marginBottom: 14 }}>
              The consent request has been queued. This vision demo stops at submission.
            </div>
            <button type="button" onClick={onClose} style={{ borderRadius: 4, padding: '9px 14px', background: 'var(--bg)', border: '1px solid var(--ink)', color: 'var(--ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}

function FormulationCard({ formulation, onRequest, onViewProfile }) {
  const readiness = getReadiness(formulation.effectiveness);
  const segments = getOutcomeSegments(formulation.outcomes);
  const sideEffectRate = ((formulation.sideEffects.count / formulation.tracked) * 100).toFixed(1);

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{formulation.anonId}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
        Southwest Nigeria · {getPreparationType(formulation.preparation)} · {formulation.ingredients.length} ingredients
      </div>

      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {formulation.conditions.map((condition) => (
          <span key={condition} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: 'rgba(27,107,58,0.12)', color: '#4ADE80' }}>{condition}</span>
        ))}
      </div>

      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {formulation.ingredients.map((ingredient) => (
          <span key={ingredient.botanical} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, background: 'rgba(184,134,11,0.14)', color: '#FCD34D' }}>{ingredient.botanical}</span>
        ))}
      </div>

      <div style={{ marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
        {formulation.effectiveness}% patient-reported improvement (n={formulation.tracked}) · {formulation.timeline} average recovery window · {formulation.sideEffects.count} side effects ({sideEffectRate}% rate)
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 2, height: 20, borderRadius: 6, overflow: 'hidden' }}>
        {segments.map((segment) => (
          <div key={segment.key} style={{ width: `${segment.value}%`, background: segment.color }} />
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: readiness.bg, color: readiness.color }}>{readiness.label}</span>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" onClick={onRequest} style={{ borderRadius: 8, padding: '8px 14px', background: COLORS.forest, border: `1px solid ${COLORS.forest}`, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Request collaboration →</button>
        <button type="button" onClick={onViewProfile} style={{ borderRadius: 8, padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>View full profile</button>
      </div>
    </div>
  );
}

function FullProfile({ formulation, onBack }) {
  const segments = getOutcomeSegments(formulation.outcomes);

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 18 }}>
      <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: COLORS.forest, cursor: 'pointer', fontSize: 14, marginBottom: 10 }}>← Back to results</button>
      <FormulationCard formulation={formulation} onRequest={() => {}} onViewProfile={() => {}} />

      <div style={{ marginTop: 12, fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>
        Age distribution: 18-35 (24%), 35-50 (41%), 50+ (35%). Sex: Male 38%, Female 62%.
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>Monthly outcome trend</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
          {formulation.monthlyOutcomes.map((item) => (
            <div key={item.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{item.tracked}</div>
              <div style={{ width: '100%', maxWidth: 34, height: `${Math.max(8, item.eff)}px`, borderRadius: '4px 4px 0 0', background: 'linear-gradient(180deg, #4ADE80 0%, #1B6B3A 100%)' }} />
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{item.month}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>Ingredient analysis</div>
        {formulation.ingredients.map((ingredient) => {
          const compound = COMPOUNDS.find((item) => item.botanical === ingredient.botanical);
          return (
            <div key={ingredient.botanical} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{ingredient.botanical}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                {compound
                  ? `${compound.count} formulations · ${compound.conditions.join(', ')} · ${compound.eff}% average patient-reported improvement`
                  : 'No aggregate compound profile available in this demo dataset'}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
        This formulation has been documented by a practitioner with 40+ years of experience. Nagoya Protocol-compliant collaboration terms are available.
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 2, height: 20, borderRadius: 6, overflow: 'hidden' }}>
        {segments.map((segment) => (
          <div key={segment.key} style={{ width: `${segment.value}%`, background: segment.color }} />
        ))}
      </div>
    </div>
  );
}

export default function ResearcherView() {
  const [search, setSearch] = useState('anti-inflammatory, Yoruba, Southwest Nigeria');
  const [selectedFormulation, setSelectedFormulation] = useState(null);
  const [collaborationStep, setCollaborationStep] = useState(1);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [selectedTier, setSelectedTier] = useState('research');
  const [expandedCompound, setExpandedCompound] = useState(null);

  const filtered = useMemo(() => filterFormulations(search), [search]);
  const withOutcomeData = filtered.filter((item) => item.tracked > 0).length;
  const highReadiness = filtered.filter((item) => item.effectiveness >= 80).length;

  const selected = selectedFormulation ? FORMULATIONS.find((item) => item.id === selectedFormulation) : null;

  return (
    <div className="view-light view-researcher researcher-shell" style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'inline-block', padding: '5px 12px', borderRadius: 999, background: 'rgba(184,134,11,0.12)', border: '1px solid rgba(184,134,11,0.24)', color: COLORS.gold, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
        Sanko Research Portal
      </div>
      <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', serif", fontSize: 24, color: 'rgba(255,255,255,0.92)' }}>Explore Africa's traditional medicine evidence</h2>
      <div style={{ marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>
        Search anonymised formulation data with consent-gated access. No recipes without practitioner approval.
      </div>

      <div className="researcher-search" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 16px' }}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.78)', fontSize: 14, fontFamily: "'Manrope', sans-serif" }}
        />
      </div>

      <div style={{ marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
        {filtered.length} formulations found · {withOutcomeData} with documented patient-reported outcomes · {highReadiness} with reported improvement above 80%
      </div>

      <div style={{ marginTop: 8, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--muted)', fontStyle: 'italic' }}>
        Patient-reported outcomes. Documentation signal, not clinical efficacy.
      </div>

      <div style={{ marginTop: 14 }}>
        <EOSMPanel />
      </div>

      <div className="researcher-results" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {selected ? (
          <FullProfile formulation={selected} onBack={() => setSelectedFormulation(null)} />
        ) : (
          filtered.map((formulation) => (
            <FormulationCard
              key={formulation.id}
              formulation={formulation}
              onRequest={() => {
                setCollaborationOpen(true);
                setRequestSent(false);
                setCollaborationStep(1);
                setSelectedTier('research');
              }}
              onViewProfile={() => setSelectedFormulation(formulation.id)}
            />
          ))
        )}
      </div>

      <div className="researcher-compounds" style={{ marginTop: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
        <div className="researcher-compounds-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', fontWeight: 700 }}>Compound frequency explorer</div>
          <button type="button" style={{ background: 'none', border: 'none', color: COLORS.forest, fontSize: 13, cursor: 'pointer' }}>Export dataset →</button>
        </div>

        <div className="researcher-compounds-table-head" style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 2fr 1fr', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>
          <div>Botanical name</div><div>Local name(s)</div><div>Formulations</div><div>Top conditions</div><div>Avg reported improvement</div>
        </div>

        {COMPOUNDS.map((compound) => (
          <div key={compound.botanical}>
            <button
              type="button"
              onClick={() => setExpandedCompound((prev) => (prev === compound.botanical ? null : compound.botanical))}
              className="researcher-compounds-row"
              style={{ width: '100%', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', textAlign: 'left', padding: '8px 0', display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 2fr 1fr', gap: 8, alignItems: 'center', color: 'rgba(255,255,255,0.72)', fontFamily: "'Manrope', sans-serif", fontSize: 13 }}
            >
              <div style={{ fontWeight: 700 }}>{compound.botanical}</div>
              <div style={{ color: 'rgba(255,255,255,0.5)' }}>{compound.local}</div>
              <div>{compound.count}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {compound.conditions.map((condition) => (
                  <span key={condition} style={{ padding: '1px 6px', borderRadius: 6, fontSize: 12, background: 'rgba(27,107,58,0.12)', color: '#4ADE80' }}>{condition}</span>
                ))}
              </div>
              <div style={{ color: compound.eff >= 80 ? '#4ADE80' : '#FCD34D' }}>{compound.eff}%</div>
            </button>

            {expandedCompound === compound.botanical && (
              <div style={{ padding: '0 0 10px 0', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                This ingredient appears in {compound.count} formulations across the Sanko database, primarily for {compound.conditions.join(', ')}. Average patient-reported improvement in formulations containing this compound: {compound.eff}%.
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="researcher-flow-strip" style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 16, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
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

      {collaborationOpen && (
        <CollaborationModal
          step={collaborationStep}
          selectedTier={selectedTier}
          onSelectTier={setSelectedTier}
          isSent={requestSent}
          onClose={() => {
            setCollaborationOpen(false);
            setRequestSent(false);
            setCollaborationStep(1);
          }}
          onNext={() => setCollaborationStep((value) => Math.min(3, value + 1))}
          onBack={() => setCollaborationStep((value) => Math.max(1, value - 1))}
          onSend={() => setRequestSent(true)}
        />
      )}
    </div>
  );
}
