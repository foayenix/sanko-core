---
name: Sanko Indigo Knowledge Signal
description: Evidence infrastructure for African traditional medicine.
colors:
  signal-indigo: "#17134f"
  deep-indigo: "#0b0930"
  mineral-white: "#f5f2e8"
  medicinal-chartreuse: "#c8f35b"
  oxidised-copper: "#d76545"
  copper-ink: "#9f3e29"
  ink: "#090a23"
  indigo-line: "#3a3671"
  mineral-muted: "#c9c6d5"
  ink-muted: "#565369"
typography:
  display:
    fontFamily: "Archivo, Arial Narrow, sans-serif"
    fontSize: "clamp(3.375rem, 5vw, 5rem)"
    fontWeight: 820
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Archivo, Arial Narrow, sans-serif"
    fontSize: "clamp(2.875rem, 5.5vw, 5.25rem)"
    fontWeight: 820
    lineHeight: 1
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  data-label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.055em"
rounded:
  square: "0"
spacing:
  xs: "8px"
  sm: "14px"
  md: "24px"
  lg: "44px"
  xl: "80px"
components:
  button-signal:
    backgroundColor: "{colors.medicinal-chartreuse}"
    textColor: "{colors.signal-indigo}"
    rounded: "{rounded.square}"
    padding: "13px 23px"
    height: "50px"
  button-outline-light:
    backgroundColor: "transparent"
    textColor: "{colors.mineral-white}"
    rounded: "{rounded.square}"
    padding: "13px 23px"
    height: "50px"
---

# Design System: Sanko Indigo Knowledge Signal

## Overview

**Creative North Star: “Indigo Knowledge Signal”**

Sanko makes the journey from living knowledge to verifiable evidence visible. A continuous angular knowledge thread links source material, medicinal-plant mappings, formulations, patient follow-up and governance records. The system feels culturally grounded through indigo construction logic and stewardship language, not decorative folklore.

The visual world is assured, precise and institution-ready. It rejects pale generic SaaS layouts, glossy AI effects and anonymous data imagery.

**Key Characteristics:**

- Saturated indigo fields with mineral-white reading relief.
- Chartreuse reserved for active knowledge, actions and connections.
- Square, registry-like records connected by meaningful thread nodes.
- The D1 **Source Mark** is the primary Sanko logo: a compact block silhouette with a chamfered top-right corner, one square counter and a single right arm, used beside the uppercase wordmark.
- Illustrative records clearly labelled and never presented as clinical evidence.

## Colors

Signal Indigo is the dominant institutional field. Mineral White creates high-contrast reading surfaces; Medicinal Chartreuse indicates active information and action. Oxidised Copper is a rare source and registration accent.

### Primary

- **Signal Indigo** (`#17134f`): Primary backgrounds, navigation and institutional sections.
- **Medicinal Chartreuse** (`#c8f35b`): Primary actions, knowledge threads, active data and emphasis.

### Secondary

- **Oxidised Copper** (`#d76545`): Registration marks, source accents and warm details on dark fields.
- **Copper Ink** (`#9f3e29`): Accessible copper expression on Mineral White.

### Neutral

- **Mineral White** (`#f5f2e8`): Reading surfaces, private-record panels and light sections.
- **Deep Indigo** (`#0b0930`): Footer and deepest background.
- **Ink** (`#090a23`): Text on light surfaces.
- **Indigo Line** (`#3a3671`): Dividers on indigo.
- **Mineral Muted** (`#c9c6d5`): Secondary text on indigo.
- **Ink Muted** (`#565369`): Secondary text on Mineral White.

**The Signal Rarity Rule.** Chartreuse marks action, transformation or an important live quantity. It is never an ambient page background except for a single decisive conversion passage.

## Typography

**Display Font:** Archivo Variable with Arial Narrow fallback  
**Body Font:** Archivo Variable with sans-serif fallback  
**Label/Mono Font:** IBM Plex Mono

**Character:** Archivo provides a wide, declarative institutional voice without becoming clinical. IBM Plex Mono is limited to data, measurements, provenance metadata and status labels.

### Hierarchy

- **Display** (820, `clamp(54px, 5vw, 80px)`, `0.98`): First-view proposition only.
- **Headline** (820, `clamp(46px, 5.5vw, 84px)`, `1`): Section theses.
- **Title** (700–750, 23–31px, `1.12–1.2`): Journey and audience entries.
- **Body** (400–650, 16–20px, `1.4–1.55`): Explanations, generally kept below 65 characters per line.
- **Data Label** (600, 7–12px, uppercase): Provenance, status, mapping and record metadata.

**The Plain-Language Lead Rule.** Explain the practitioner or institutional outcome before naming implementation technology.

## Layout

The desktop shell is capped at 1480px with at least 32px side gutters. Thesis sections use asymmetric two-column grids; process and audience passages use edge-to-edge indexed rules rather than card collections. Section spacing ranges from about 80px to 150px.

At 1180px the horizontal knowledge thread becomes an alternating vertical provenance spine. At 860px major two-column passages stack and navigation becomes a menu containing the primary WhatsApp action. At 560px the vertical thread moves to the left rail and all signal records stack in source order.

## Elevation & Depth

The system uses no box shadows. Depth comes from tonal fields, line hierarchy, overlapping registration marks and the contrast between indigo and mineral record surfaces.

**The Flat Evidence Rule.** Records stay flat and inspectable. Shadows, blur and glass effects are not part of this world.

## Shapes

The form language is square and registry-like: zero-radius actions, rectangular records, one-pixel rules and square knot nodes rotated 45 degrees. Circles appear only where function requires them, such as the voice-note play control.

## Components

### Buttons

- **Shape:** Square, zero radius, minimum 50px height.
- **Primary:** Chartreuse fill with Signal Indigo text and 13px by 23px padding.
- **Hover / Focus:** Two-pixel upward movement on hover; Copper focus outline with four-pixel separation.
- **Secondary:** Transparent with a Mineral White or Ink border appropriate to the surface.

### Cards / Containers

- **Corner Style:** Square.
- **Background:** Usually the parent field; private records use Mineral White.
- **Shadow Strategy:** None.
- **Border:** One-pixel Chartreuse, Ink or tonal rule.
- **Internal Padding:** Usually 16–24px.

### Inputs / Fields

- **Style:** Transparent, square fields with a single bottom rule; multiline fields use a complete one-pixel border.
- **Focus:** Border changes to Medicinal Chartreuse; caret is chartreuse on indigo.
- **Error / Disabled:** Disabled illustrative controls stay visibly inert; future errors should use Oxidised Copper with plain recovery language.

### Navigation

Sticky Signal Indigo navigation uses flat white icon and wordmark, compact Archivo links and a chartreuse rectangular WhatsApp action. Mobile navigation opens below the header and keeps the WhatsApp action inside the menu.

### Knowledge Thread

The knowledge thread is an angular Chartreuse line with square knot nodes. It must connect meaningful transformations, never act as an ornamental border. Desktop may draw it once on load; reduced-motion users receive the completed state immediately. Tablet and mobile use a vertical spine.

### Record Panels

Source, plant, formulation and patient panels use mono metadata, precise technical glyphs and one-pixel rules. Illustrative record content must be labelled wherever a visitor could mistake it for live patient or clinical evidence.

## Do's and Don'ts

### Do:

- **Do** use the D1 Source Mark as the recognisable logo anchor.
- **Do** use the thread to show capture, mapping, tracking, consent or governance relationships.
- **Do** keep provenance and practitioner ownership visible wherever knowledge is structured.
- **Do** use real counts from project data and label illustrative records.
- **Do** qualify Nagoya language as alignment rather than certification or compliance.

### Don't:

- **Don't** use generic African patterns, wellness stock imagery or anonymous decorative motifs.
- **Don't** introduce gradients, glass panels, rounded SaaS cards or ambient glow.
- **Don't** imply clinical efficacy, regulatory approval, encryption or certification without supplied evidence.
- **Don't** use monospace typography as a general display costume.
- **Don't** turn the knowledge thread into an empty border disconnected from content.
