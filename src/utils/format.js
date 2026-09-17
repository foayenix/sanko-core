// Shared WhatsApp message formatting for structured formulations.
// Single source of truth for the confirmation card — previously duplicated
// (with drift) across guidedDoc, expressDoc, and photoCapture.

// Renders the confirmation card for a structured formulation (PRD §4.3 shape).
// options.source adds a "_Source: …_" line (e.g. 'photo').
function formatCard(s, { source } = {}) {
  const lines = [];

  const cond = s.condition?.standardised || s.condition?.local_name;
  if (cond) lines.push(`*Condition:* ${cond}`);

  if (s.plants?.length) {
    lines.push('*Plants:*');
    for (const p of s.plants) {
      const name = p.botanical ? `${p.local_name} (${p.botanical})` : p.local_name;
      const qty  = p.quantity_normalised || p.quantity_raw || '';
      lines.push(`  • ${name}${qty ? ' — ' + qty : ''}${!p.botanical ? ' ⚠️' : ''}`);
    }
  }

  if (s.preparation?.method) {
    const dur = s.preparation.duration_minutes ? ` for ${s.preparation.duration_minutes} min` : '';
    const med = s.preparation.medium ? ` in ${s.preparation.medium}` : '';
    lines.push(`*Preparation:* ${s.preparation.method}${dur}${med}`);
  }

  if (s.dosage?.amount || s.dosage?.frequency) {
    const amt  = s.dosage.amount || '';
    const freq = s.dosage.frequency ? `, ${s.dosage.frequency}` : '';
    const days = s.dosage.duration_days ? `, for ${s.dosage.duration_days} days` : '';
    lines.push(`*Dosage:* ${amt}${freq}${days}`);
  }

  const conf = s.metadata?.confidence_score;
  if (conf != null) lines.push(`_Confidence: ${Math.round(conf * 100)}%_`);
  if (source) lines.push(`_Source: ${source}_`);

  if (s.plants?.some(p => !p.botanical)) {
    lines.push('_⚠️ = plant not in lookup, flagged for review_');
  }

  return lines.join('\n');
}

module.exports = { formatCard };
