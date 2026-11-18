'use strict';
// Controlled vocabularies for the open plant literature index
// (docs/SANKO_EVIDENCE_ATLAS_SPEC.md, section 5).
//
// `evidence_kind` and `source_status` deliberately reuse the evidence workflow's
// values in src/evidence/reports.js, so a reviewed profile can consume index
// entries without translation. The index adds `case_report` and does not use
// `traditional_account` (that is practitioner testimony, which never enters the
// index). This module imports nothing: the Atlas build must not reach code that
// touches the Vault, care or evidence-request data.

// Fixed display order: human evidence first, so "0 human trials" is the first
// thing a reader sees rather than the last.
const EVIDENCE_KIND = [
  'human_interventional',
  'human_observational',
  'case_report',
  'systematic_review',
  'animal',
  'in_vitro',
  'ethnobotanical_report',
  'analytical_quality',
  'reference_monograph',
];

const EVIDENCE_KIND_LABEL = {
  human_interventional: 'Human trials',
  human_observational: 'Human observational studies',
  case_report: 'Case reports',
  systematic_review: 'Systematic reviews',
  animal: 'Animal studies',
  in_vitro: 'Laboratory (in vitro) studies',
  ethnobotanical_report: 'Ethnobotanical surveys',
  analytical_quality: 'Chemical and quality analyses',
  reference_monograph: 'Reference monographs',
};

const SOURCE_STATUS = ['active', 'corrected', 'retracted', 'questioned', 'unknown'];

const PUBLICATION_TYPE = ['peer_reviewed', 'preprint', 'thesis', 'book_chapter', 'report', 'unknown'];

// How the botanical name printed in the study relates to the indexed taxon.
// `pending` means the automated pass found the name only outside the title and
// a person has to read the study to say what it printed.
const NAME_RESOLUTION = ['exact', 'synonym', 'curated_correction', 'unresolved', 'pending'];

const MENTION_LOCATION = ['title', 'abstract'];

const SCREENING = ['include', 'exclude', 'uncertain'];

const EXCLUSION_REASON = [
  'wrong_taxon',
  'no_original_data',
  'name_only_mention',
  'duplicate',
  'not_retrievable',
  'not_research_publication',
];

// Body systems / outcome areas. Labelled "studied for" on public pages, never
// "used for": the index says what researchers looked at, not what works.
const AREA = [
  'metabolic',
  'infection',
  'cardiovascular',
  'hepatic',
  'renal',
  'inflammation_pain',
  'oncology',
  'reproductive',
  'gastrointestinal',
  'neurological_mental',
  'respiratory',
  'haematological',
  'skin_wound',
  'oxidative_stress',
  'nutrition',
  'toxicology',
  'other',
];

const AREA_LABEL = {
  metabolic: 'Metabolic (glucose, lipids, weight)',
  infection: 'Infection and parasites',
  cardiovascular: 'Heart and blood pressure',
  hepatic: 'Liver',
  renal: 'Kidney',
  inflammation_pain: 'Inflammation and pain',
  oncology: 'Cancer',
  reproductive: 'Reproductive health',
  gastrointestinal: 'Digestive system',
  neurological_mental: 'Nervous system and mental health',
  respiratory: 'Respiratory system',
  haematological: 'Blood',
  skin_wound: 'Skin and wounds',
  oxidative_stress: 'Oxidative stress',
  nutrition: 'Nutrition and composition',
  toxicology: 'Toxicology',
  other: 'Other',
};

const PLANT_PART = [
  'leaf', 'root', 'root_bark', 'stem_bark', 'bark', 'stem', 'seed', 'fruit',
  'flower', 'whole_plant', 'rhizome', 'tuber', 'bulb', 'latex', 'oil', 'not_reported',
];

const MODEL = [
  'human', 'rat', 'mouse', 'rabbit', 'other_animal', 'cell_line',
  'microorganism', 'chemical_assay', 'not_reported',
];

const VOUCHER = ['yes', 'no', 'not_stated'];

const CLASSIFIED_BY = ['automated', 'human'];

const REVIEWER_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

module.exports = {
  AREA,
  AREA_LABEL,
  CLASSIFIED_BY,
  EVIDENCE_KIND,
  EVIDENCE_KIND_LABEL,
  EXCLUSION_REASON,
  MENTION_LOCATION,
  MODEL,
  NAME_RESOLUTION,
  PLANT_PART,
  PUBLICATION_TYPE,
  REVIEWER_ID,
  SCREENING,
  SOURCE_STATUS,
  VOUCHER,
};
