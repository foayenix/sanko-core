import { useEffect, useMemo, useState } from 'react';
import { FORMULATIONS, PATIENTS, COLORS } from '../data';
import EOSMPanel from '../components/EOSMPanel';

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'vault', label: 'My vault', badge: '43' },
  { id: 'patients', label: 'Patients' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'community', label: 'Community' },
  { id: 'reports', label: 'Practice reports' },
  { id: 'settings', label: 'Settings' },
];

const GHOST_FORMULATIONS = [
  { name: 'Agbo Ẹjẹ', conditions: ['Blood cleansing'] },
  { name: 'Omi Ara', conditions: ['Wellness', 'Detox'] },
  { name: 'Aseje Omo', conditions: ['Children tonic'] },
  { name: 'Agbo Ọgbẹ', conditions: ['Wound care'] },
  { name: 'Ewe Ìwòsàn', conditions: ['General healing'] },
];

function filterVault(formulations, term) {
  const words = term
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (!words.length) {
    return formulations;
  }

  return formulations.filter((formulation) => {
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

function getOutcomeSegments(outcomes) {
  return [
    { key: 'recovered', label: 'Recovered', color: COLORS.forest, value: outcomes.recovered },
    { key: 'improved', label: 'Improved', color: '#4ADE80', value: outcomes.improved },
    { key: 'noChange', label: 'No change', color: COLORS.gold, value: outcomes.noChange },
    { key: 'worsened', label: 'Worsened', color: COLORS.terra, value: outcomes.worsened },
  ];
}

function DashboardView({ onOpenVault, onOpenPatient, onOpenFormulation, onOpenPatients }) {
  return (
    <div className="practitioner-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          onClick={onOpenPatient}
          style={{
            textAlign: 'left',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid rgba(27,107,58,0.12)',
            background: 'rgba(27,107,58,0.06)',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1.5 }}>
            <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Patient #47</strong> — Day 7 check-in: fever broke, appetite returned. Agbo Iba.
            <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>2 hours ago</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenFormulation}
          style={{
            textAlign: 'left',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '12px 14px',
            border: '1px solid rgba(184,134,11,0.12)',
            background: 'rgba(184,134,11,0.06)',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1.5 }}>
            <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Research interest:</strong> University of Ibadan flagged Omi Isu Diabetis. 2 researchers interested.
            <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>Yesterday</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenPatients}
          style={{
            textAlign: 'left',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.02)',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1.5 }}>
            3 patients due for follow-up today. <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Patient #51</strong> (Day 3), <strong style={{ color: 'rgba(255,255,255,0.85)' }}>#44</strong> (Day 7), <strong style={{ color: 'rgba(255,255,255,0.85)' }}>#39</strong> (Day 14 final).
            <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>Scheduled</span>
          </span>
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <EOSMPanel />
      </div>

      <div className="practitioner-dashboard-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 28, color: COLORS.forest }}>43</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Formulations in vault</div>
          <div style={{ marginTop: 4, fontSize: 13, color: COLORS.forest, fontWeight: 600 }}>+3 this month</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 28, color: '#fff' }}>284</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Patients tracked</div>
          <div style={{ marginTop: 4, fontSize: 13, color: COLORS.forest, fontWeight: 600 }}>+18 this month</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 28, color: COLORS.forest }}>87%</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Overall patient-reported improvement (n=284)</div>
          <div style={{ marginTop: 4, fontSize: 13, color: COLORS.forest, fontWeight: 600 }}>Across all formulations</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 28, color: COLORS.gold }}>4.1</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Avg days to recovery</div>
          <div style={{ marginTop: 4, fontSize: 13, color: COLORS.forest, fontWeight: 600 }}>Fever formulations</div>
        </div>
      </div>

      <div style={{ marginTop: -4, fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--muted)', fontStyle: 'italic' }}>
        Patient-reported outcomes. Documentation signal, not clinical efficacy.
      </div>

      <div className="practitioner-dashboard-top-formulations" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '16px 16px 8px' }}>
        <div className="practitioner-dashboard-top-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'rgba(255,255,255,0.45)' }}>
            Top formulations by outcomes
          </div>
          <button
            type="button"
            onClick={onOpenVault}
            style={{
              background: 'none',
              border: 'none',
              color: COLORS.forest,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            See all 43 →
          </button>
        </div>

        {FORMULATIONS.map((formulation, index) => {
          const segments = getOutcomeSegments(formulation.outcomes);
          const effectivenessColor = formulation.effectiveness >= 80 ? COLORS.forest : formulation.effectiveness >= 70 ? COLORS.gold : 'rgba(255,255,255,0.5)';

          return (
            <button
              key={formulation.id}
              type="button"
              onClick={() => onOpenFormulation(formulation.id)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                borderBottom: index === FORMULATIONS.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                padding: '10px 0',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: "'Manrope', sans-serif",
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `rgba(27,107,58,${0.08 + (index % 3) * 0.04})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: 700 }}>
                  {index + 1}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>{formulation.name}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>{formulation.conditions.join(', ')} · {formulation.ingredients.length} ingredients</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: effectivenessColor }}>{formulation.effectiveness}%</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>{formulation.tracked} tracked</div>
                </div>
              </div>

              <div style={{ marginTop: 8, display: 'flex', gap: 2, height: 20, borderRadius: 6, overflow: 'hidden' }}>
                {segments.map((segment) => (
                  <div
                    key={segment.key}
                    style={{
                      width: `${segment.value}%`,
                      background: segment.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      color: '#fff',
                      fontWeight: 700,
                    }}
                  >
                    {segment.value >= 12 ? `${segment.value}%` : ''}
                  </div>
                ))}
              </div>

              <div className="practitioner-outcome-legend" style={{ marginTop: 6, display: 'flex', gap: 12, fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
                <span>● Recovered</span>
                <span>● Improved</span>
                <span>● No change</span>
                <span>● Worsened</span>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>HTSN community — Lagos chapter</div>
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: COLORS.forest, fontSize: 13, cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}
          >
            View full →
          </button>
        </div>

        <div className="practitioner-dashboard-community-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 10 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 22, color: '#fff' }}>214</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Active practitioners</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 10 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 22, color: '#fff' }}>8,420</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Total formulations</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 10 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 22, color: COLORS.forest }}>84%</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Avg patient-reported improvement</div>
          </div>
        </div>

        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(255,255,255,0.35)' }}>
          Aggregated across all members. Individual formulations remain private unless shared. These numbers can be shown to regulators, health authorities, and partners.
        </p>
      </div>
    </div>
  );
}

function VaultView({ search, onSearchChange, formulations, onSelectFormulation }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }}>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search medicines..."
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 13,
            fontFamily: "'Manrope', sans-serif",
            padding: 0,
          }}
        />
      </div>

      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', marginBottom: 12 }}>
        {search.trim() ? `${formulations.length} results for '${search}'` : `${formulations.length} formulations`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {formulations.map((formulation) => {
          const badgeColor = formulation.effectiveness >= 80 ? COLORS.forest : formulation.effectiveness >= 70 ? COLORS.gold : 'rgba(255,255,255,0.5)';

          return (
            <button
              key={formulation.id}
              type="button"
              onClick={() => onSelectFormulation(formulation.id)}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 14,
                padding: 20,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.2s ease',
                fontFamily: "'Manrope', sans-serif",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)', marginBottom: 10 }}>{formulation.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {formulation.conditions.map((condition) => (
                  <span key={condition} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: 'rgba(27,107,58,0.12)', color: '#4ADE80' }}>
                    {condition}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>{formulation.ingredients.length} ingredients</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: badgeColor }}>{formulation.effectiveness}%</span>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Private</span>
              </div>
            </button>
          );
        })}

        {GHOST_FORMULATIONS.map((ghost) => (
          <div key={ghost.name} style={{ opacity: 0.3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)', marginBottom: 10 }}>{ghost.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {ghost.conditions.map((condition) => (
                <span key={condition} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: 'rgba(27,107,58,0.12)', color: '#4ADE80' }}>
                  {condition}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Private</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormulationDetailView({ formulation, playingAudio, onToggleAudio, onBack }) {
  const segments = getOutcomeSegments(formulation.outcomes);
  const confidenceLabel = formulation.tracked >= 200 ? `High confidence (${formulation.tracked}+ outcomes)` : formulation.tracked >= 50 ? `Medium (${formulation.tracked})` : `Low (${formulation.tracked})`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        type="button"
        onClick={onBack}
        style={{ alignSelf: 'flex-start', marginBottom: 4, fontSize: 14, color: COLORS.forest, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}
      >
        ← My vault
      </button>

      <div>
        <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', serif", fontSize: 24, color: 'rgba(255,255,255,0.9)' }}>{formulation.name}</h2>
        <div style={{ marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Documented {formulation.documented} · Private</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {formulation.conditions.map((condition) => (
          <span key={condition} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: 'rgba(27,107,58,0.12)', color: '#4ADE80' }}>
            {condition}
          </span>
        ))}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>Ingredients ({formulation.ingredients.length})</div>
        {formulation.ingredients.map((ingredient, index) => (
          <div key={ingredient.local} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: index === formulation.ingredients.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
              <strong>{ingredient.local}</strong> — <span style={{ color: 'rgba(255,255,255,0.5)' }}>{ingredient.english}</span>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontFamily: "'Manrope', sans-serif", fontStyle: 'italic' }}>{ingredient.botanical}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>Preparation</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 12 }}>{formulation.preparation}</div>
        <button
          type="button"
          onClick={onToggleAudio}
          style={{ borderRadius: 8, padding: '8px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)', fontSize: 13, cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}
        >
          Play original voice recording
        </button>

        {playingAudio && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 24 }}>
              {[14, 20, 11, 22, 16, 19, 13].map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  style={{
                    width: 3,
                    height,
                    borderRadius: 99,
                    background: COLORS.forest,
                    animation: `wave 1s ${index * 0.07}s infinite ease-in-out alternate`,
                  }}
                />
              ))}
            </div>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Playing... 1:12</span>
          </div>
        )}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>Dosing</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>{formulation.dosing}</div>
      </div>

      {!!formulation.warnings?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {formulation.warnings.map((warning) => (
            <span key={warning} style={{ background: 'rgba(158,74,47,0.12)', color: '#F87171', padding: '3px 10px', fontSize: 12, fontWeight: 700, borderRadius: 6 }}>
              {warning}
            </span>
          ))}
        </div>
      )}

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>Expected outcome</div>
        <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 99, background: 'rgba(184,134,11,0.12)', border: '1px solid rgba(184,134,11,0.3)', color: COLORS.gold, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          {formulation.timeline}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {formulation.successIndicators.map((indicator) => (
            <span key={indicator} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: 'rgba(27,107,58,0.12)', color: '#4ADE80' }}>
              {indicator}
            </span>
          ))}
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>Patient outcomes</div>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 48, color: '#4ADE80', lineHeight: 1 }}>{formulation.effectiveness}%</div>

        <div style={{ marginTop: 12, display: 'flex', gap: 3, height: 28, borderRadius: 8, overflow: 'hidden' }}>
          {segments.map((segment) => (
            <div key={segment.key} style={{ width: `${segment.value}%`, background: segment.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
              {segment.value >= 10 ? `${segment.value}%` : ''}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
          <span>● Recovered</span>
          <span>● Improved</span>
          <span>● No change</span>
          <span>● Worsened</span>
        </div>

        <div className="practitioner-detail-kpis" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24, color: '#fff' }}>4.2</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Avg days to improvement</div>
          </div>
          <div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24, color: '#fff' }}>91%</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Completed full course</div>
          </div>
          <div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 24, color: '#fff' }}>{formulation.sideEffects.count}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Side effects ({formulation.sideEffects.severity})</div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'inline-block', padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
          {confidenceLabel}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>Monthly trend</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
            {formulation.monthlyOutcomes.map((monthData) => (
              <div key={monthData.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 4 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{monthData.tracked}</div>
                <div style={{ width: '100%', maxWidth: 32, borderRadius: '4px 4px 0 0', background: 'linear-gradient(180deg, #4ADE80 0%, #1B6B3A 100%)', height: `${Math.max(8, (monthData.eff / 100) * 100)}px` }} />
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{monthData.month}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {formulation.researchInterest > 0 && (
        <div style={{ background: 'rgba(45,75,142,0.06)', border: '1px solid rgba(45,75,142,0.12)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>
            {formulation.researchInterest} researchers have expressed interest in this formulation.
          </div>
          <button
            type="button"
            style={{ borderRadius: 8, padding: '8px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.78)', cursor: 'pointer', fontFamily: "'Manrope', sans-serif", fontSize: 13 }}
          >
            View requests →
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={{ borderRadius: 8, padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontFamily: "'Manrope', sans-serif", fontSize: 13 }}>Edit</button>
        <button type="button" style={{ borderRadius: 8, padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontFamily: "'Manrope', sans-serif", fontSize: 13 }}>Share</button>
      </div>
    </div>
  );
}

function getPatientStatusBadge(status) {
  if (status === 'recovered') {
    return { background: 'rgba(27,107,58,0.16)', color: '#4ADE80', label: 'Recovered' };
  }
  if (status === 'improved') {
    return { background: 'rgba(184,134,11,0.16)', color: '#FCD34D', label: 'Improved' };
  }
  return { background: 'rgba(45,75,142,0.15)', color: '#60A5FA', label: 'Tracking' };
}

function PatientsView({ onSelectPatient }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '6px 14px' }}>
      {PATIENTS.map((patient) => {
        const formulationName = FORMULATIONS.find((formulation) => formulation.id === patient.formulationId)?.name || 'Unknown';
        const badge = getPatientStatusBadge(patient.status);

        return (
          <button
            key={patient.id}
            type="button"
            onClick={() => onSelectPatient(patient.id)}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              cursor: 'pointer',
              padding: '10px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textAlign: 'left',
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
              {patient.sex}
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>{patient.ref}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>{patient.age} · {patient.sex} · {patient.condition}</div>
            </div>

            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{formulationName}</div>
              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: badge.background, color: badge.color }}>
                {badge.label}
              </span>
              <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{patient.date}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PatientTimelineView({ patientId, onBack }) {
  const patient = PATIENTS.find((item) => item.id === patientId);
  const formulation = FORMULATIONS.find((item) => item.id === patient?.formulationId);

  if (!patient) {
    return <div style={{ padding: 20, color: 'rgba(255,255,255,0.35)' }}>Patient not found.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', fontSize: 14, color: COLORS.forest, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Manrope', sans-serif" }}>← Patients</button>

      <div>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 20, color: 'rgba(255,255,255,0.9)' }}>{patient.ref}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{patient.age} · {patient.sex} · {patient.date}</div>
        <div style={{ fontSize: 13, color: COLORS.forest, marginTop: 4 }}>Prescribed: {formulation?.name || 'Unknown formulation'}</div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        {patient.timeline.map((event, index) => {
          const dotColor = event.type === 'prescribed' ? COLORS.forest : event.type === 'checkin' ? '#60A5FA' : event.type === 'final' ? '#4ADE80' : 'rgba(255,255,255,0.2)';
          return (
            <div key={`${event.day}-${event.type}-${index}`} style={{ display: 'flex', gap: 12, paddingBottom: 16, borderLeft: index < patient.timeline.length - 1 ? '2px solid rgba(255,255,255,0.06)' : '2px solid transparent', marginLeft: 6, paddingLeft: 20, position: 'relative' }}>
              <div style={{ position: 'absolute', left: -7, top: 0, width: 12, height: 12, borderRadius: '50%', background: dotColor }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>Day {event.day}</div>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{event.text}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>{event.date}</div>
                {event.sideEffect && <span style={{ display: 'inline-block', marginTop: 6, background: 'rgba(158,74,47,0.12)', color: '#F87171', padding: '3px 10px', fontSize: 12, fontWeight: 700, borderRadius: 6 }}>{event.sideEffect}</span>}
                {event.type === 'final' && <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(27,107,58,0.12)', color: '#4ADE80', fontSize: 14, fontWeight: 700 }}>Outcome: {patient.status === 'recovered' ? 'Recovered' : patient.status === 'improved' ? 'Improved' : 'Tracking'}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutcomesView() {
  const monthly = [
    { month: 'Sep', value: 82 },
    { month: 'Oct', value: 83 },
    { month: 'Nov', value: 85 },
    { month: 'Dec', value: 86 },
    { month: 'Jan', value: 87 },
    { month: 'Feb', value: 88 },
  ];

  const byCondition = [
    { label: 'Tonic/Vitality', value: 91 },
    { label: 'Fever/Malaria', value: 87 },
    { label: 'Pile/Stomach', value: 84 },
    { label: 'Diabetes', value: 82 },
    { label: 'Body heat', value: 78 },
    { label: 'Cough', value: 76 },
  ];

  const byFormulation = [...FORMULATIONS].sort((first, second) => second.effectiveness - first.effectiveness);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>Practice patient-reported outcomes over time</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
          {monthly.map((item, index) => (
            <div key={item.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 6 }}>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{item.value}%</div>
              <div style={{ width: '100%', maxWidth: 34, height: `${item.value * 1.2}px`, borderRadius: '4px 4px 0 0', background: `rgba(27,107,58,${0.55 + index * 0.06})` }} />
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{item.month}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>Reported improvement by condition</div>
        {byCondition.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: '0 0 140px', fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{item.label}</div>
            <div style={{ flex: 1, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
              <div style={{ width: `${item.value}%`, height: '100%', borderRadius: 4, background: 'rgba(27,107,58,0.8)' }} />
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{item.value}%</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>Reported improvement by formulation</div>
        {byFormulation.map((item) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: '0 0 140px', fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{item.name}</div>
            <div style={{ flex: 1, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
              <div style={{ width: `${item.effectiveness}%`, height: '100%', borderRadius: 4, background: item.effectiveness >= 80 ? 'rgba(27,107,58,0.8)' : 'rgba(184,134,11,0.8)' }} />
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{item.effectiveness}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommunityView() {
  const conditions = [
    { label: 'Malaria/Fever', value: 39 },
    { label: 'Diabetes', value: 17 },
    { label: 'Cough', value: 14 },
    { label: 'Hypertension', value: 11 },
    { label: 'Other', value: 19 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="practitioner-community-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 14 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 26 }}>214</div><div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Active members</div></div>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 14 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 26 }}>8,420</div><div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Total formulations</div></div>
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 14 }}><div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 26, color: COLORS.forest }}>84%</div><div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Avg patient-reported improvement</div></div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 10 }}>Top conditions across HTSN Lagos</div>
        {conditions.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: '0 0 130px', fontSize: 14, color: 'rgba(255,255,255,0.45)' }}>{item.label}</div>
            <div style={{ flex: 1, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
              <div style={{ width: `${item.value}%`, height: '100%', borderRadius: 4, background: 'rgba(27,107,58,0.8)' }} />
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{item.value}%</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(27,107,58,0.08)', border: '1px solid rgba(27,107,58,0.18)', borderRadius: 12, padding: 14, fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>
        Individual practitioner data is never shared. Community statistics are aggregated and anonymised. These numbers can be presented to regulators, health authorities, and partners.
      </div>
    </div>
  );
}

function ReportsView({ onDownload }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 18, color: 'rgba(255,255,255,0.9)' }}>Practice Report — February 2030</div>
      <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Practitioner: Baba Adeyemi · Lagos, Nigeria</div>
      <div style={{ margin: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: 'rgba(255,255,255,0.65)' }}>
        <div><strong>Consultations this month:</strong> 18</div>
        <div><strong>Top conditions:</strong> Fever (7), Cough (4), Diabetes (3), Body pains (2), Other (2)</div>
        <div><strong>Medicines used:</strong> Agbo Iba (7), Agbo Ikọ́ (4), Omi Isu Diabetis (3), Others (4)</div>
        <div><strong>Outcomes tracked:</strong> 12</div>
        <div><strong>Overall patient-reported improvement:</strong> 92%</div>
      </div>

      <button type="button" onClick={onDownload} style={{ marginTop: 14, borderRadius: 8, padding: '10px 20px', background: COLORS.forest, border: `1px solid ${COLORS.forest}`, color: '#fff', cursor: 'pointer', fontFamily: "'Manrope', sans-serif", fontSize: 13, fontWeight: 700 }}>
        Download PDF
      </button>
    </div>
  );
}

function SettingsView() {
  const rows = [
    { label: 'Language', value: 'Yorùbá' },
    { label: 'Default privacy', value: 'Private (only me)' },
    { label: 'Notifications', value: 'WhatsApp + App' },
  ];

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '8px 16px' }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)' }}>{row.label}</div>
          <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 13, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)' }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

const VoiceClip = ({ duration }) => (
    <div className="practitioner-wa-voice">
      <span>▶</span>
      <div className="practitioner-wa-waveform">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <span style={{ fontSize: 10, color: 'rgba(13,27,42,0.45)' }}>{duration}</span>
    </div>
  );

  const Bubble = ({ from = 'bot', time, children, buttons }) => (
    <div className={`practitioner-wa-msg ${from === 'user' ? 'user' : 'bot'}`}>
      <div>{children}</div>
      <div className="time">{time}</div>
      {buttons?.length ? (
        <div className="practitioner-wa-btns">
          {buttons.map((button) => (
            <div key={button} className="practitioner-wa-btn">{button}</div>
          ))}
        </div>
      ) : null}
    </div>
  );

function PractitionerWhatsAppView() {
  const screens = [
    {
      title: 'First message',
      note: 'Under 90 seconds · account = phone number',
      body: (
        <>
          <Bubble
            time="9:41 AM"
            buttons={['English', 'Yorùbá', 'Igbo']}
          >
            <strong>Welcome to Sanko!</strong><br /><br />
            I help traditional medicine practitioners protect and document their knowledge safely.<br /><br />
            Your medicines are encrypted and protected. What language do you prefer?
          </Bubble>
          <Bubble time="9:41 AM">
            E kú àárọ̀! Kí ni orúkọ yín?<br /><br />
            Send a voice note, or type your name.
          </Bubble>
          <VoiceClip duration="0:03" />
          <Bubble
            time="9:42 AM"
            buttons={['Document a medicine', 'Learn more', 'How is it protected?']}
          >
            E ṣé, <strong>Baba Adeyemi</strong>! Your vault is created and locked.<br /><br />
            What would you like to do?
          </Bubble>
        </>
      ),
    },
    {
      title: 'Guided documentation',
      note: 'One question at a time · always confirm',
      body: (
        <>
          <Bubble time="9:43 AM">
            Step 1 of 5: What is the name?<br /><br />
            Send a voice note with the name.
          </Bubble>
          <VoiceClip duration="0:02" />
          <Bubble time="9:43 AM">
            I heard: <strong>Agbo Iba</strong><br /><br />
            Step 2 of 5: What conditions does this treat?
          </Bubble>
          <VoiceClip duration="0:08" />
          <Bubble
            time="9:44 AM"
            buttons={['Yes', 'Re-record', 'Add more']}
          >
            I heard:<br />• Fever<br />• Malaria<br />• Body pains<br /><br />
            Is this correct?
          </Bubble>
        </>
      ),
    },
    {
      title: 'Ingredient recognition',
      note: 'Local name → English → Botanical mapping',
      body: (
        <>
          <Bubble time="9:45 AM">
            Step 3 of 5: What ingredients are in Agbo Iba?<br /><br />
            Send a voice note listing all plants and ingredients. You can also send photos.
          </Bubble>
          <VoiceClip duration="0:15" />
          <Bubble
            time="9:46 AM"
            buttons={['Yes', 'Re-record', 'Add more']}
          >
            I heard 4 ingredients:<br /><br />
            1. Dongoyaro (Neem)<br />
            <em style={{ fontSize: 10, color: 'rgba(13,27,42,0.45)' }}>Azadirachta indica</em><br />
            2. Oganho (Lemongrass)<br />
            <em style={{ fontSize: 10, color: 'rgba(13,27,42,0.45)' }}>Cymbopogon citratus</em><br />
            3. Ewuro (Bitter leaf)<br />
            <em style={{ fontSize: 10, color: 'rgba(13,27,42,0.45)' }}>Vernonia amygdalina</em><br />
            4. Mango bark<br />
            <em style={{ fontSize: 10, color: 'rgba(13,27,42,0.45)' }}>Mangifera indica</em>
          </Bubble>
        </>
      ),
    },
    {
      title: 'Save and celebrate',
      note: 'Trust moment · summary card · clear next steps',
      body: (
        <>
          <Bubble from="user" time="9:50 AM">Yes, save it!</Bubble>
          <Bubble
            time="9:50 AM"
            buttons={['Document another', 'See my vault', 'Main menu']}
          >
            <strong>SAVED AND PROTECTED!</strong><br /><br />
            Your medicine <strong>Agbo Iba</strong> is now safely documented in your Sanko Vault.<br /><br />
            Agbo Iba · Fever/Malaria/Body pains · 4 ingredients · Private
          </Bubble>
        </>
      ),
    },
    {
      title: 'Express mode',
      note: 'One voice note = one full formulation · power users',
      body: (
        <>
          <Bubble from="user" time="2:30 PM">I want to record a new medicine</Bubble>
          <Bubble time="2:30 PM" buttons={['Guide me step by step']}>
            Ready to listen!<br /><br />
            Send one voice note with name, conditions, ingredients, preparation, and dosing.<br /><br />
            Take your time — I can handle long voice notes.
          </Bubble>
          <VoiceClip duration="2:14" />
          <Bubble time="2:31 PM" buttons={['Save it!', 'Fix something', 'Re-record']}>
            Here’s what I understood:<br /><br />
            <strong>Agbo Tutu</strong><br />
            Body heat, rashes, restlessness<br />
            4 ingredients captured<br />
            Cold preparation · use fresh daily<br />
            Adults: 1 cup 3× · Children: ½ cup 2×
          </Bubble>
        </>
      ),
    },
    {
      title: 'Browse vault',
      note: 'Simple number navigation · voice search works too',
      body: (
        <>
          <Bubble from="user" time="3:00 PM">Show me my medicines</Bubble>
          <Bubble time="3:00 PM">
            <strong>Your Sanko Vault</strong><br /><br />
            1. Agbo Iba — Fever, Malaria<br />
            2. Agbo Tutu — Body heat, rashes<br />
            3. Aseje Agbara — Tonic, strength<br />
            4. Omi Isu Diabetis — Diabetes<br /><br />
            Send the number to view full details.
          </Bubble>
          <Bubble from="user" time="3:00 PM">1</Bubble>
          <Bubble time="3:01 PM" buttons={['Edit', 'Share']}>
            <strong>AGBO IBA</strong><br /><br />
            Fever, Malaria, Body pains<br />
            Dongoyaro · Oganho · Ewuro · Mango bark<br />
            Boil 1hr · sieve · store max 5 days<br />
            Adults 1 cup morning + evening<br />
            Not for pregnant women / people on hospital malaria medicine
          </Bubble>
        </>
      ),
    },
    {
      title: 'Outcome tracking trigger',
      note: 'Triggered after consultation save · one tap to enable',
      isOutcomeTracking: true,
      body: (
        <>
          <Bubble time="2:15 PM" buttons={['Yes, track outcome', 'Not this time']}>
            <strong>Consultation saved!</strong><br /><br />
            Patient #13 · Agbo Iba prescribed.<br /><br />
            Would you like to follow up on Day 3, Day 7, and Day 14 to track outcome?
          </Bubble>
          <Bubble from="user" time="2:15 PM">Yes, track outcome</Bubble>
          <Bubble time="2:15 PM">What is the patient’s phone number?</Bubble>
          <Bubble from="user" time="2:16 PM">08034567890</Bubble>
          <Bubble time="2:16 PM" buttons={['Perfect', 'Change schedule']}>
            Got it. Check-ins scheduled:<br />
            Day 3 · Tue 25 Feb<br />
            Day 7 · Sat 1 Mar<br />
            Day 14 · Sat 8 Mar
          </Bubble>
        </>
      ),
    },
    {
      title: 'Practitioner trigger (App)',
      note: 'WhatsApp or SMS channel · privacy explained',
      isOutcomeTracking: true,
      body: (
        <>
          <Bubble time="2:20 PM" buttons={['WhatsApp', 'SMS']}>
            <strong>Track this patient\'s outcome?</strong><br /><br />
            We\'ll send check-ins on Day 3, 7, and 14. Responses link to your formulation record.
          </Bubble>
          <Bubble time="2:20 PM">
            PATIENT PHONE: <strong>+234 803 456 7890</strong><br /><br />
            Patient receives messages from <strong>Sanko Health</strong> and never sees your formulation details.
          </Bubble>
          <Bubble from="user" time="2:21 PM">Start tracking</Bubble>
        </>
      ),
    },
    {
      title: 'Patient consent (Day 0)',
      note: 'Separate Sanko Health bot · explicit consent',
      isOutcomeTracking: true,
      headerName: 'Sanko Health',
      headerStatus: 'online',
      avatarBg: '#43A047',
      avatarIcon: 'SH',
      body: (
        <>
          <Bubble time="2:20 PM" buttons={['Yes, please check in', 'No thanks']}>
            Hello! We\'re checking in on your treatment progress.<br /><br />
            This is a FREE follow-up service. We\'ll ask a few simple questions over 2 weeks.<br /><br />
            Is this OK?
          </Bubble>
          <Bubble from="user" time="2:22 PM">Yes, please check in</Bubble>
          <Bubble time="2:22 PM">
            Thank you! Check-ins scheduled:<br />
            Day 3 · Tuesday<br />
            Day 7 · Saturday<br />
            Day 14 · Next Saturday<br /><br />
            Reply STOP anytime to cancel.
          </Bubble>
        </>
      ),
    },
    {
      title: 'Patient check-in (Day 3)',
      note: 'Max 3 questions · emoji buttons · voice for details',
      isOutcomeTracking: true,
      headerName: 'Sanko Health',
      headerStatus: 'online',
      avatarBg: '#43A047',
      avatarIcon: 'SH',
      body: (
        <>
          <Bubble time="9:00 AM" buttons={['Much better', 'A little better', 'About the same']}>
            It’s Day 3 since treatment started. How are you feeling compared to before?
          </Bubble>
          <Bubble from="user" time="9:15 AM">A little better</Bubble>
          <Bubble time="9:15 AM" buttons={['Yes, as instructed', 'I stopped early', 'I changed dose']}>
            Thank you! Are you still taking the medicine as instructed?
          </Bubble>
          <Bubble from="user" time="9:16 AM">Yes, as instructed</Bubble>
          <Bubble time="9:16 AM" buttons={['No problems', 'Yes, something happened']}>
            Great. Any side effects or problems?
          </Bubble>
          <Bubble from="user" time="9:17 AM">Yes, something happened</Bubble>
          <Bubble time="9:17 AM">Please send a voice note describing what happened.</Bubble>
          <VoiceClip duration="0:06" />
        </>
      ),
    },
    {
      title: 'Patient check-in (Day 14 final)',
      note: 'Clean closure · data feeds back to formulation',
      isOutcomeTracking: true,
      headerName: 'Sanko Health',
      headerStatus: 'online',
      avatarBg: '#43A047',
      avatarIcon: 'SH',
      body: (
        <>
          <Bubble time="9:00 AM" buttons={['Yes, fully recovered', 'Mostly recovered', 'Partially helped']}>
            Final check-in! It\'s been 2 weeks.<br /><br />
            Overall, did the treatment help?
          </Bubble>
          <Bubble from="user" time="10:30 AM">Yes, fully recovered</Bubble>
          <Bubble time="10:30 AM">
            Wonderful! Thank you for completing the follow-up.<br /><br />
            Your feedback helps improve traditional medicine for everyone.
          </Bubble>
        </>
      ),
    },
    {
      title: 'Patient check-in (SMS fallback)',
      note: 'Works on any phone · number-based responses',
      isOutcomeTracking: true,
      headerName: 'SMS · +234 700 SANKO',
      headerStatus: 'text channel',
      avatarBg: '#2D4B8E',
      avatarIcon: 'SMS',
      body: (
        <>
          <Bubble time="9:00 AM">
            Day 3 check-in: How are you feeling?<br /><br />
            Reply: 1=Much better, 2=A little better, 3=Same, 4=Worse
          </Bubble>
          <Bubble from="user" time="9:02 AM">2</Bubble>
          <Bubble time="9:03 AM">
            Are you taking medicine as instructed?<br />
            1=Yes, 2=Stopped, 3=Changed dose
          </Bubble>
          <Bubble from="user" time="9:04 AM">1</Bubble>
          <Bubble time="9:04 AM">Great. We\'ll check in again on Saturday. - Sanko Health</Bubble>
        </>
      ),
    },
    {
      title: 'Practitioner alert',
      note: 'Individual update + running formulation stats',
      isOutcomeTracking: true,
      body: (
        <>
          <Bubble time="9:20 AM" buttons={['Call patient', 'Add note', 'Noted']}>
            <strong>Outcome update</strong><br /><br />
            Patient #13 · Day 3<br />
            Feeling: A little better<br />
            Compliance: Taking as instructed<br />
            Side effect: Mild stomach upset
          </Bubble>
          <Bubble time="9:20 AM">
            <strong>Agbo Iba running outcomes</strong><br /><br />
            12 patients tracked<br />
            8 recovered · 3 improving · 1 no change<br />
            <strong>92% documented patient-reported improvement</strong>
          </Bubble>
        </>
      ),
    },
    {
      title: 'Formulation outcomes (App)',
      note: 'Aggregated outcomes on formulation detail',
      isOutcomeTracking: true,
      body: (
        <>
          <Bubble time="10:10 AM">
            <strong>Agbo Iba outcomes</strong><br /><br />
            34 patients tracked · 29 completed follow-up<br />
            85% reported improvement<br />
            Recovered 24 · Improved 5 · No change 3 · Worsened 2
          </Bubble>
          <Bubble time="10:11 AM">
            Confidence: <strong>Medium</strong> (need 50+ for high confidence).<br /><br />
            Actions: View all patients · Export PDF report
          </Bubble>
        </>
      ),
    },
    {
      title: 'Clinic mode follow-up',
      note: 'Practitioner logs outcomes during return visit',
      isOutcomeTracking: true,
      body: (
        <>
          <Bubble time="9:00 AM" buttons={['Yes, I saw them', 'Yes, they called', 'No contact']}>
            Reminder: Patient #13 Day 7 follow-up is due today. Did this patient return or contact you?
          </Bubble>
          <Bubble from="user" time="11:30 AM">Yes, I saw them</Bubble>
          <Bubble time="11:30 AM" buttons={['Fully recovered', 'Improving', 'No change']}>
            How is Patient #13 doing today?
          </Bubble>
          <Bubble from="user" time="11:31 AM">Improving</Bubble>
          <Bubble time="11:31 AM">Outcome recorded. Agbo Iba now: 12 tracked · 92% effectiveness.</Bubble>
        </>
      ),
    },
    {
      title: 'Monthly report',
      note: 'Auto-generated practice report for evidence',
      isOutcomeTracking: true,
      body: (
        <>
          <Bubble time="Mar 1 · 8:00 AM" buttons={['Get PDF report', 'Compare last month']}>
            <strong>Monthly Practice Report · Feb 2026</strong><br /><br />
            Consultations: 18<br />
            Top conditions: Fever/Malaria (7), Cough (4), Diabetes (3)<br />
            Outcomes tracked: 12<br />
            Overall patient-reported improvement: 92%
          </Bubble>
        </>
      ),
    },
  ];

  const screenPages = [
    {
      id: 'whatsapp-flow',
      label: 'WhatsApp flow',
      screens: screens.filter((screen) => !screen.isOutcomeTracking),
    },
    {
      id: 'outcome-tracking',
      label: 'Outcome tracking',
      screens: screens
        .filter((screen) => screen.isOutcomeTracking)
        .sort((left, right) => {
          const outcomeOrder = [
            'Outcome tracking trigger',
            'Practitioner trigger (App)',
            'Patient consent (Day 0)',
            'Patient check-in (Day 3)',
            'Patient check-in (Day 14 final)',
            'Patient check-in (SMS fallback)',
            'Practitioner alert',
            'Formulation outcomes (App)',
            'Clinic mode follow-up',
            'Monthly report',
          ];

          return outcomeOrder.indexOf(left.title) - outcomeOrder.indexOf(right.title);
        }),
    },
  ];

  const [activePageIndex, setActivePageIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);

  const goNext = () => {
    setActivePageIndex((value) => (value + 1) % screenPages.length);
  };

  const goPrev = () => {
    setActivePageIndex((value) => (value - 1 + screenPages.length) % screenPages.length);
  };

  const handleTouchStart = (event) => {
    setTouchStartX(event.changedTouches?.[0]?.clientX ?? null);
  };

  const handleTouchEnd = (event) => {
    if (touchStartX == null) {
      return;
    }

    const endX = event.changedTouches?.[0]?.clientX ?? touchStartX;
    const deltaX = touchStartX - endX;
    const threshold = 40;

    if (deltaX > threshold) {
      goNext();
    } else if (deltaX < -threshold) {
      goPrev();
    }

    setTouchStartX(null);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'ArrowRight') {
        setActivePageIndex((value) => (value + 1) % screenPages.length);
      }

      if (event.key === 'ArrowLeft') {
        setActivePageIndex((value) => (value - 1 + screenPages.length) % screenPages.length);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [screenPages.length]);

  useEffect(() => {
    if (!autoPlayEnabled) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setActivePageIndex((value) => (value + 1) % screenPages.length);
    }, 3500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoPlayEnabled, screenPages.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)' }}>
        Practitioner interaction via WhatsApp (from prototype flow)
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button type="button" onClick={goPrev} className="practitioner-carousel-nav">← Previous</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {screenPages[activePageIndex]?.label} · Page {activePageIndex + 1} / {screenPages.length}
          </div>
          <button
            type="button"
            onClick={() => setAutoPlayEnabled((value) => !value)}
            className={`practitioner-carousel-nav ${autoPlayEnabled ? 'active' : ''}`}
          >
            {autoPlayEnabled ? 'Pause autoplay' : 'Autoplay'}
          </button>
        </div>
        <button type="button" onClick={goNext} className="practitioner-carousel-nav">Next →</button>
      </div>

      <div
        className="practitioner-carousel-viewport"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="practitioner-carousel-track"
          style={{ transform: `translateX(-${activePageIndex * 100}%)` }}
        >
          {screenPages.map((page, pageIndex) => (
            <div key={`page-${pageIndex}`} className="practitioner-carousel-slide">
              <div className="practitioner-wa-page-grid">
                {page.screens.map((screen) => (
                  <div key={screen.title} className="practitioner-wa-card" style={{ border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--bg)', padding: 10 }}>
                    <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 700, marginBottom: 8 }}>
                      {screen.title}
                    </div>

                    <div className="practitioner-wa-phone">
                      <div className="practitioner-wa-head">
                        <div className="practitioner-wa-avatar" style={{ background: screen.avatarBg || '#1B6B3A' }}>{screen.avatarIcon || 'SK'}</div>
                        <div>
                          <div className="practitioner-wa-name">{screen.headerName || 'Sanko'}</div>
                          <div className="practitioner-wa-status">{screen.headerStatus || 'online'}</div>
                        </div>
                      </div>

                      <div className="practitioner-wa-body">{screen.body}</div>

                      <div className="practitioner-wa-input">
                        <div className="practitioner-wa-input-field">Type a message</div>
                        <div className="practitioner-wa-input-mic">Voice</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', lineHeight: 1.45 }}>
                      {screen.note}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="practitioner-carousel-dots">
        {screenPages.map((page, index) => (
          <button
            key={page.id}
            type="button"
            onClick={() => setActivePageIndex(index)}
            className={`practitioner-carousel-dot ${index === activePageIndex ? 'active' : ''}`}
            aria-label={`Go to ${page.label}`}
          />
        ))}
      </div>

      <div style={{ marginTop: 2, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
        Patient-reported outcomes. Documentation signal, not clinical efficacy.
      </div>

      <style>{`
        .practitioner-wa-phone {
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid var(--rule);
          background: #ECE5DD;
          width: 300px;
          max-width: 100%;
          height: 620px;
          display: flex;
          flex-direction: column;
          margin: 0 auto;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #1A2C34;
        }

        .practitioner-wa-phone * {
          font-family: inherit;
        }

        .practitioner-wa-head {
          background: #1F2C34;
          padding: 8px 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .practitioner-wa-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1B6B3A;
          font-size: 14px;
          flex-shrink: 0;
        }

        .practitioner-wa-name {
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.2;
        }

        .practitioner-wa-status {
          color: rgba(255,255,255,0.55);
          font-size: 10px;
        }

        .practitioner-wa-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .practitioner-wa-msg {
          max-width: 88%;
          font-size: 12px;
          line-height: 1.45;
          border-radius: 8px;
          padding: 7px 9px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }

        .practitioner-wa-msg.bot {
          align-self: flex-start;
          background: #fff;
          border-top-left-radius: 0;
          color: #1A2C34;
        }

        .practitioner-wa-msg.user {
          align-self: flex-end;
          background: #DCF8C6;
          border-top-right-radius: 0;
          color: #1A2C34;
        }

        .practitioner-wa-msg .time {
          text-align: right;
          font-size: 10px;
          color: rgba(0,0,0,0.45);
          margin-top: 3px;
        }

        .practitioner-wa-btns {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 6px;
        }

        .practitioner-wa-btn {
          background: #fff;
          border: 1px solid #E3E3E3;
          border-radius: 7px;
          padding: 6px 7px;
          font-size: 12px;
          color: #1B6B3A;
          text-align: center;
        }

        .practitioner-wa-voice {
          align-self: flex-end;
          background: #DCF8C6;
          border-radius: 20px;
          padding: 5px 10px;
          display: flex;
          align-items: center;
          gap: 7px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.08);
          color: #1A2C34;
        }

        .practitioner-wa-waveform {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 16px;
        }

        .practitioner-wa-waveform span {
          display: block;
          width: 2px;
          border-radius: 2px;
          background: #1B6B3A;
          animation: wave 1.2s ease infinite;
        }

        .practitioner-wa-waveform span:nth-child(1) { height: 5px; animation-delay: 0s; }
        .practitioner-wa-waveform span:nth-child(2) { height: 12px; animation-delay: .1s; }
        .practitioner-wa-waveform span:nth-child(3) { height: 7px; animation-delay: .2s; }
        .practitioner-wa-waveform span:nth-child(4) { height: 14px; animation-delay: .3s; }
        .practitioner-wa-waveform span:nth-child(5) { height: 9px; animation-delay: .15s; }
        .practitioner-wa-waveform span:nth-child(6) { height: 6px; animation-delay: .25s; }
        .practitioner-wa-waveform span:nth-child(7) { height: 10px; animation-delay: .05s; }

        .practitioner-wa-input {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #f0f0f0;
          padding: 8px 10px;
        }

        .practitioner-wa-input-field {
          flex: 1;
          background: #fff;
          border-radius: 18px;
          padding: 8px 12px;
          font-size: 12px;
          color: rgba(13,27,42,0.55);
        }

        .practitioner-wa-input-mic {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #25D366;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 14px;
          flex-shrink: 0;
        }

        .practitioner-carousel-nav {
          border: 1px solid var(--rule);
          background: var(--bg);
          color: var(--ink-soft);
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 11px;
          font-family: 'Manrope', sans-serif;
          cursor: pointer;
        }

        .practitioner-carousel-nav.active {
          background: var(--ink-soft);
          color: var(--bg);
          border-color: var(--ink-soft);
        }

        .practitioner-carousel-viewport {
          overflow: hidden;
          border-radius: 4px;
        }

        .practitioner-carousel-track {
          display: flex;
          transition: transform 240ms ease;
          will-change: transform;
        }

        .practitioner-carousel-slide {
          flex: 0 0 100%;
          max-width: 100%;
        }

        .practitioner-wa-page-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(320px, 1fr));
          gap: 14px;
          align-items: start;
        }

        .practitioner-wa-card {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .practitioner-carousel-dots {
          display: flex;
          justify-content: center;
          gap: 6px;
          margin-top: 2px;
        }

        .practitioner-carousel-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          border: 1px solid var(--rule);
          background: transparent;
          cursor: pointer;
          padding: 0;
        }

        .practitioner-carousel-dot.active {
          background: var(--ink-soft);
          border-color: var(--ink-soft);
        }

        @media (max-width: 1200px) {
          .practitioner-wa-phone {
            width: 280px;
            height: 580px;
          }

          .practitioner-wa-page-grid {
            grid-template-columns: repeat(2, minmax(300px, 1fr));
          }
        }

        @media (max-width: 760px) {
          .practitioner-carousel-nav {
            font-size: 10px;
            padding: 5px 8px;
          }

          .practitioner-wa-page-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

export default function PractitionerView() {
  const [surfaceTab, setSurfaceTab] = useState('practitioner');
  const [subView, setSubView] = useState('dashboard');
  const [selectedFormulation, setSelectedFormulation] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [vaultSearch, setVaultSearch] = useState('');
  const [playingAudio, setPlayingAudio] = useState(false);
  const [reportToast, setReportToast] = useState(false);

  const filteredVault = useMemo(() => filterVault(FORMULATIONS, vaultSearch), [vaultSearch]);

  const patientExists = PATIENTS.some((patient) => patient.id === 'p47');
  const activeFormulation = selectedFormulation ? FORMULATIONS.find((formulation) => formulation.id === selectedFormulation) : null;

  return (
    <div className="view-light view-practitioner practitioner-shell" style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <style>{`
        @keyframes wave {
          from { transform: scaleY(0.5); opacity: 0.5; }
          to { transform: scaleY(1); opacity: 1; }
        }
      `}</style>

      <div className="practitioner-surface-toggle" style={{ marginBottom: 14, display: 'flex', justifyContent: 'center' }}>
        <div className="practitioner-surface-toggle-grid" style={{ display: 'inline-grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--rule)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg)' }}>
          <button
            type="button"
            onClick={() => setSurfaceTab('practitioner')}
            style={{
              border: 'none',
              borderRight: '1px solid var(--rule)',
              background: surfaceTab === 'practitioner' ? 'var(--ink)' : 'var(--bg)',
              color: surfaceTab === 'practitioner' ? 'var(--bg)' : 'var(--ink)',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Manrope', sans-serif",
              padding: '8px 14px',
              cursor: 'pointer',
            }}
          >
            Practitioner view
          </button>
          <button
            type="button"
            onClick={() => setSurfaceTab('web')}
            style={{
              border: 'none',
              background: surfaceTab === 'web' ? 'var(--ink)' : 'var(--bg)',
              color: surfaceTab === 'web' ? 'var(--bg)' : 'var(--ink)',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Manrope', sans-serif",
              padding: '8px 14px',
              cursor: 'pointer',
            }}
          >
            Web dashboard
          </button>
        </div>
      </div>

      {surfaceTab === 'practitioner' ? (
        <PractitionerWhatsAppView />
      ) : (
        <>
          <div className="practitioner-web-note" style={{ marginBottom: 12, fontFamily: "'Manrope', sans-serif", fontStyle: 'italic', color: 'var(--muted)', fontSize: 13 }}>
            Generated from WhatsApp documentation. See Practitioner view tab for source interaction.
          </div>

          <div className="practitioner-web-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
        <aside className="practitioner-web-aside" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 20, alignSelf: 'start' }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: COLORS.forest, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              BA
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>Baba Adeyemi</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Lagos, Nigeria · HTSN Member</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {NAV.map((item) => {
              const active = subView === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSubView(item.id);
                    setSelectedFormulation(null);
                    setSelectedPatient(null);
                    setPlayingAudio(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? 'rgba(27,107,58,0.08)' : 'transparent',
                    color: active ? COLORS.forest : 'rgba(255,255,255,0.65)',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "'Manrope', sans-serif",
                    textAlign: 'left',
                  }}
                >
                  <span>{item.label}</span>
                  {item.badge && (
                    <span style={{ marginLeft: 'auto', padding: '2px 7px', borderRadius: 999, fontSize: 12, border: '1px solid rgba(27,107,58,0.3)', color: COLORS.forest, background: 'rgba(27,107,58,0.1)' }}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="practitioner-web-main">
          {activeFormulation ? (
            <FormulationDetailView
              formulation={activeFormulation}
              playingAudio={playingAudio}
              onToggleAudio={() => setPlayingAudio((value) => !value)}
              onBack={() => {
                setSelectedFormulation(null);
                setSubView('vault');
                setPlayingAudio(false);
              }}
            />
          ) : selectedPatient ? (
            <PatientTimelineView
              patientId={selectedPatient}
              onBack={() => setSelectedPatient(null)}
            />
          ) : subView === 'dashboard' ? (
            <DashboardView
              onOpenVault={() => {
                setSubView('vault');
                setSelectedFormulation(null);
                setSelectedPatient(null);
              }}
              onOpenPatient={() => {
                if (patientExists) {
                  setSelectedPatient('p47');
                  setSelectedFormulation(null);
                }
              }}
              onOpenFormulation={(id = 'f2') => {
                setSelectedFormulation(id);
                setPlayingAudio(false);
              }}
              onOpenPatients={() => {
                setSubView('patients');
                setSelectedFormulation(null);
                setSelectedPatient(null);
              }}
            />
          ) : subView === 'vault' ? (
            <VaultView
              search={vaultSearch}
              onSearchChange={setVaultSearch}
              formulations={filteredVault}
              onSelectFormulation={(id) => {
                setSelectedFormulation(id);
                setPlayingAudio(false);
              }}
            />
          ) : subView === 'patients' ? (
            <PatientsView onSelectPatient={setSelectedPatient} />
          ) : subView === 'outcomes' ? (
            <OutcomesView />
          ) : subView === 'community' ? (
            <CommunityView />
          ) : subView === 'reports' ? (
            <ReportsView
              onDownload={() => {
                setReportToast(true);
                setTimeout(() => setReportToast(false), 3000);
              }}
            />
          ) : subView === 'settings' ? (
            <SettingsView />
          ) : (
            <div style={{ padding: 40, color: 'rgba(255,255,255,0.3)' }}>Coming in next phase</div>
          )}
        </section>
          </div>

          <div className="practitioner-flow-strip" style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 16, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
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

          {reportToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-alt)', border: '1px solid var(--rule)', borderRadius: 999, padding: '8px 14px', fontSize: 13, color: 'var(--ink-soft)', zIndex: 1000 }}>
          Demo — PDF not available in preview
        </div>
          )}
        </>
      )}
    </div>
  );
}