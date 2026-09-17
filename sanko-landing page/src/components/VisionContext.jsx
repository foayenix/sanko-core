export default function VisionContext({ visible, onContinue, onDismiss }) {
  if (!visible) {
    return null;
  }

  return (
    <section className="vision-context">
      <div className="vision-context__header">
        <span className="vision-context__num">00</span>
        <h3 className="vision-context__title">What you are looking at</h3>
      </div>
      <div className="vision-context__kicker">
        The Sanko 2030 platform vision.
      </div>

      <div className="vision-context__grid">
        <div>
          <div className="vision-context__label">Today</div>
          <div className="vision-context__list">
            <div>Sanko Vault MVP in development</div>
            <div>HTSN partnership confirmed</div>
            <div>Yemkem clinic as pilot site</div>
          </div>
        </div>

        <div className="vision-context__divider" />

        <div>
          <div className="vision-context__label">2030 (shown below)</div>
          <div className="vision-context__list">
            <div>Four-persona platform</div>
            <div>3 countries active · 6+ targeted</div>
            <div>141,000 tracked outcomes</div>
            <div>Pharmacovigilance system</div>
            <div>Tiered ABS data access</div>
          </div>
        </div>
      </div>

      <div className="vision-context__note">
        This demonstration shows the system Sanko is designed to become, not what currently exists. Numbers and dashboards are illustrative of the 2030 vision.
      </div>

      <div className="vision-context__actions">
        <button
          type="button"
          onClick={onContinue}
          className="vision-context__btn vision-context__btn--primary"
        >
          Continue to vision →
        </button>

        <button
          type="button"
          onClick={onDismiss}
          className="vision-context__btn vision-context__btn--ghost"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
