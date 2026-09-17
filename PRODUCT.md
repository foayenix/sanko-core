# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The public website serves companies and organisations evaluating Sanko for partnership, funding, research, regulation, or traditional-medicine network use. The product itself is used by African traditional medicine practitioners who document formulations and patient care through WhatsApp.

## Product Purpose

Sanko turns practitioners’ voice notes, text, and photographed records into private, structured records of herbal formulations and patient care. The website must help institutional visitors understand the product, test the working WhatsApp agent, and begin a partnership conversation.

Success means a visitor can quickly understand what Sanko does, why its privacy and knowledge-governance model matters, experience the agent through WhatsApp, and contact Sanko about partnership.

## Positioning

Sanko combines a familiar practitioner interface—WhatsApp—with locally operated AI, a growing medicinal-plant name map, practitioner-scoped records, patient tracking, and Nagoya-aligned knowledge provenance. It is infrastructure for documenting traditional medicine without requiring practitioners to learn a new application or surrender control of their knowledge.

## Operating Context

Practitioners communicate through WhatsApp using text, voice notes, and photographs. The public website is shown to companies, funders, NGOs, research institutions, regulators, and traditional-medicine organisations. A Baileys-hosted WhatsApp agent will provide the live product test linked from the website.

## Capabilities and Constraints

- Publicly approved capabilities: local/private AI processing, medicinal-plant mappings, patient tracking, and Nagoya alignment.
- The medicinal-plant mapping count must be derived from `data/plant_lookup_v1.json` so the website updates as mappings are added.
- The landing page must offer two primary actions: test Sanko on WhatsApp and start a partnership conversation.
- WhatsApp and partnership contact details are placeholders until real endpoints are supplied.
- The website must not present invented customer logos, testimonials, usage metrics, clinical efficacy claims, regulatory approvals, or commercial partnerships as things Sanko has achieved.
- The website may show a projected record: what a formulation's documented history looks like after years of accumulated use. Sanko's value is longitudinal, and a site that shows only what exists on day one undersells what the product is for.
- A projection must read as a projection at a glance. Frame it in the future or the conditional, label it at the figures themselves rather than in fine print beneath them, and never style it as achieved results. Projected numbers are not usage metrics or clinical outcomes, and must not be worded as observed, reported, measured, or recorded.
- Patient tracking is documentation support, not a claim of clinical efficacy.

## Brand Commitments

- Product name: Sanko.
- The D1 pixel-cross source mark is the approved Sanko logo for the website and product shell; older bird and seal artwork is legacy material.
- Public language should be credible to institutional audiences while remaining clear about practitioner ownership and privacy.

## Evidence on Hand

- Working Node.js/Express WhatsApp agent and simulator in this repository.
- `data/plant_lookup_v1.json` is the source of truth for the current mapping count.
- Local LLM and transcription configuration is documented in `README.md` and `.env.example`.
- Formulation, patient, treatment, correction, and provenance-related data structures are present in the Supabase migrations and application services.
- `PRIVACY.md` documents the current privacy and Nagoya posture.
- Existing Sanko identity assets are available under `sanko-landing page/public/` and `sanko-landing page/PNG/`.
- No approved testimonials, customer logos, clinical results, or commercial performance metrics are available; future work must not pass fabricated versions of them off as real. Projected records showing where the product is going are governed by the Capabilities and Constraints above.

## Product Principles

1. Let visitors experience the working product, not just read claims about it.
2. Show where the product is going as well as what runs today, and keep the two visibly distinct.
3. Preserve practitioner ownership and source attribution as first-class product value.
4. Explain technical sovereignty in plain institutional language.
5. Show evidence and system mechanics without implying clinical validation.
6. Make partnership and product testing equally easy to start.

## Accessibility & Inclusion

The website must work well on mobile and desktop, use clear plain language, maintain accessible contrast and focus states, respect reduced-motion preferences, and remain usable with keyboard and assistive technology.
