export default function EOSMPanel() {
  return (
    <section
      style={{
        border: '1px solid var(--rule)',
        background: 'var(--bg-alt)',
        borderRadius: 4,
        padding: 16,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--gold)', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
            0X
          </span>
          <h3 style={{ margin: 0, fontFamily: "'Manrope', sans-serif", fontSize: 22, color: 'var(--ink)' }}>
            Evidence Ontology and Structuring Method (EOSM)
          </h3>
        </div>
        <div style={{ marginTop: 4, fontFamily: "'Manrope', sans-serif", fontStyle: 'italic', fontSize: 15, color: 'var(--ink-soft)' }}>
          How practitioner inputs become research-grade records.
        </div>
      </div>

      <div className="eosm-grid" style={{ borderTop: '1px solid var(--rule)' }}>
        <article style={{ padding: '12px 0' }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: 'var(--gold)', fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700 }}>
              Layer 1 ·
            </span>{' '}
            <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 18, color: 'var(--ink)' }}>
              Input normalisation
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)', marginBottom: 10 }}>
            Multilingual practitioner inputs — voice, text, photo — converted to structured botanical entities mapped to Latin names, herbarium identifiers, and ConPhyMP 2022 reporting standards.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '4px 6px' }}>
                "Agbo iba" [Yoruba]
              </span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '4px 6px' }}>
                "Bitter leaf tea" [Eng]
              </span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '4px 6px' }}>
                [plant photo]
              </span>
            </div>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 18, color: 'var(--ink-soft)' }}>→</span>
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '6px 8px' }}>
              Vernonia amygdalina · HRB-NGA-00482
            </span>
          </div>
        </article>

        <article style={{ padding: '12px 0' }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: 'var(--gold)', fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700 }}>
              Layer 2 ·
            </span>{' '}
            <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 18, color: 'var(--ink)' }}>
              Outcome tracking protocol
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)', marginBottom: 10 }}>
            WhatsApp-based patient follow-up at Days 3, 7, and 14. Designed for low-literacy users. Patient-reported outcomes linked to formulation records with anonymised identifiers.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '4px 6px' }}>
                Day 3 · How do you feel?
              </span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '4px 6px' }}>
                Day 7 · Better / Same / Worse
              </span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '4px 6px' }}>
                Day 14 · Final report
              </span>
            </div>
            <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 18, color: 'var(--ink-soft)' }}>→</span>
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, border: '1px solid var(--rule)', padding: '6px 8px' }}>
              Outcome record · Patient #0042 · anonymised ID
            </span>
          </div>
        </article>

        <article style={{ padding: '12px 0' }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: 'var(--gold)', fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700 }}>
              Layer 3 ·
            </span>{' '}
            <span style={{ fontFamily: "'Manrope', sans-serif", fontSize: 18, color: 'var(--ink)' }}>
              Anonymisation with provenance
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)', marginBottom: 10 }}>
            Treatment efficacy is provable without exposing formulations. Practitioner identity, exact ingredient ratios, and preparation methods are encrypted. Statistical signals are visible to researchers; the source recipe is not.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ border: '1px solid var(--rule)', padding: 8 }}>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, marginBottom: 4 }}>Researcher sees:</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, color: 'var(--ink-soft)' }}>Condition: Hypertension</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, color: 'var(--ink-soft)' }}>Botanicals: V. amygdalina, M. oleifera</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, color: 'var(--ink-soft)' }}>Outcome: 81% reported improvement (n=124)</div>
            </div>
            <div style={{ border: '1px solid var(--rule)', padding: 8 }}>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, marginBottom: 4 }}>Researcher does not see:</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, color: 'var(--ink-soft)' }}>Ratios: [encrypted]</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, color: 'var(--ink-soft)' }}>Preparation method: [encrypted]</div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, color: 'var(--ink-soft)' }}>Practitioner: [anonymised ID]</div>
            </div>
          </div>
        </article>
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--rule)', fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
        Aligned to ConSEFS 2018 · ConPhyMP 2022 · Schema v1.0 published CC-BY 4.0
      </div>

      <style>{`
        .eosm-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .eosm-grid article {
          border-right: 1px solid var(--rule);
          padding-right: 12px;
        }

        .eosm-grid article:last-child {
          border-right: none;
          padding-right: 0;
        }

        @media (max-width: 980px) {
          .eosm-grid {
            grid-template-columns: 1fr;
            gap: 0;
          }

          .eosm-grid article {
            border-right: none;
            border-bottom: 1px solid var(--rule);
            padding-right: 0;
          }

          .eosm-grid article:last-child {
            border-bottom: none;
          }
        }
      `}</style>
    </section>
  );
}
