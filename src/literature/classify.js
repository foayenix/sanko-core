'use strict';
// Automated first-pass classification of an index entry.
//
// Inputs are the title, author keywords, MeSH descriptors and publication types —
// bibliographic metadata only. Abstracts are never read here and never stored
// (spec 5.2). Every output is marked `classified_by: automated` and stays out of
// public counts until a person verifies it against the study itself, so these
// rules are tuned to give a reviewer a useful starting point, not to be right.
// When a rule cannot tell, it says so (`null`, `uncertain`) instead of guessing.

const has = (text, pattern) => pattern.test(text);

const RULES = {
  // Notices and opinion pieces carry no original data about the plant.
  nonResearchPubType: /^(published erratum|retraction of publication|comment|editorial|letter|news|expression of concern|correction|patent)$/i,
  reviewPubType: /^(review|review-article)$/i,
  systematic: /systematic review|meta-analys/i,
  trialPubType: /^(randomized controlled trial|clinical trial(, phase [iv]+)?|controlled clinical trial|pragmatic clinical trial)$/i,
  trialTitle: /randomi[sz]ed|placebo|double-blind|single-blind|clinical trial|crossover trial|pilot trial/i,
  casePubType: /^case reports?$/i,
  caseTitle: /case report|case series/i,
  humanObs: /cohort|cross-sectional|case-control|among (patients|women|men|adults|children|participants)|patients? (with|attending)|questionnaire-based|prevalence of (use|herbal)/i,
  ethno: /ethnobotan|ethnomedic|ethnopharmac|ethnoveterinar|ethno-?medicinal|traditional (knowledge|healers?)|folk medicine|indigenous knowledge|medicinal plants? used|survey of medicinal/i,
  animal: /\brats?\b|\bmice\b|\bmouse\b|\brabbits?\b|wistar|albino|sprague|in vivo|\bbroilers?\b|\bchicks?\b|\bfish\b|catfish|\bgoats?\b|\bsheep\b|\bpigs?\b|zebrafish|drosophila|guinea pigs?|\bhamsters?\b|\bdogs?\b|\bcattle\b|\blambs?\b|\bquails?\b/i,
  inVitro: /in vitro|cell lines?|cytotoxic|antimicrobial|antibacterial|antifungal|antiviral|antiplasmodial|larvicid|anthelmintic activity|antioxidant (activity|capacity|potential)|\bdpph\b|\bmic\b|minimum inhibitory|enzyme inhibit|inhibitory activity|hepg2|mcf-7|hela|biofilm|molecular docking|in silico/i,
  analytical: /phytochemical|gc-ms|hplc|lc-ms|proximate|mineral (composition|content)|nutritional|nutrient|chemical composition|heavy metals?|standardi[sz]ation|quality control|essential oil composition|isolation (and|of)|characteri[sz]ation|fatty acid/i,
  safety: /toxic|safety|adverse|hepatotox|nephrotox|genotox|cytogenet|teratogen|embryotox|\bld50\b|sub-?acute|sub-?chronic|herb-drug|drug interaction|interaction with|poisoning|mutagen/i,
};

const AREA_RULES = [
  ['metabolic', /diabet|glyc(a|e)mi|glucose|insulin|lipid|cholesterol|obes|weight|metabolic syndrome|hyperlipid/i],
  ['infection', /antimicrob|antibacter|antifung|antivir|bacteri|fung(i|al)|malaria|plasmod|parasit|anthelmint|helminth|trypanos|leishman|typhoid|salmonella|staphylococc|escherichia|candida|tubercul|mycobacter|larvicid|mosquito|schistosom|hiv\b/i],
  ['cardiovascular', /hypertens|cardio|blood pressure|vasorelax|cardiac|heart|atherosclero|antihypertens/i],
  ['hepatic', /liver|hepat/i],
  ['renal', /kidney|renal|nephr/i],
  ['inflammation_pain', /inflamm|analges|pain|nocicep|arthrit|antipyret|fever/i],
  ['oncology', /cancer|tumou?r|antiprolif|carcinom|leuk(a)?emi|apoptos|antineoplast|oncolog/i],
  ['reproductive', /fertil|sperm|testic|testost|uter|ovar|contracep|abortif|oxytoc|estrous|oestrous|pregnan|lactat|reproduct|erect/i],
  ['gastrointestinal', /ulcer|diarrh|gastr|laxat|intestin|constipat|antiemetic/i],
  ['neurological_mental', /anxi|depress|convuls|epilep|sedat|neuro|memory|cognit|alzheimer|parkinson|seizure|anxiolytic|hypnotic/i],
  ['respiratory', /asthma|cough|bronch|respirat|pulmonar|lung/i],
  ['haematological', /an(a)?emi|sickle|haemat|hemat|blood (cell|parameter|count)|erythro|coagul|platelet|haemoglobin|hemoglobin/i],
  ['skin_wound', /wound|dermat|skin|burns?\b|acne|eczema/i],
  ['oxidative_stress', /antioxid|oxidative|free radical|radical scaveng/i],
  ['nutrition', /nutri|proximate|food|feed|diet|vitamin|mineral|protein content|forage|supplement(ation|ed)? (in|of) (broiler|diet)/i],
  ['toxicology', RULES.safety],
];

const PART_RULES = [
  ['root_bark', /root[- ]bark/i],
  ['stem_bark', /stem[- ]bark/i],
  ['leaf', /\bleaf|\bleaves|foliage/i],
  ['root', /\broots?\b/i],
  ['bark', /\bbark\b/i],
  ['seed', /\bseeds?\b|kernel/i],
  ['fruit', /\bfruits?\b|\bpods?\b|\bpulp\b|\bpeel\b|\brind\b/i],
  ['flower', /\bflowers?\b|petal|calyx|calyces/i],
  ['whole_plant', /whole plant|aerial parts?/i],
  ['rhizome', /rhizome/i],
  ['tuber', /\btubers?\b/i],
  ['bulb', /\bbulbs?\b|\bcloves?\b/i],
  ['latex', /\blatex\b|\bsap\b|exudate/i],
  ['oil', /\boil\b|essential oil/i],
  ['stem', /\bstems?\b|twig|stalk/i],
];

const PREPARATION = /aqueous|ethanol(ic)?|methanol(ic)?|hydro-?ethanol(ic)?|hydro-?alcohol(ic)?|n-hexane|hexane|chloroform|ethyl acetate|dichloromethane|acetone|butanol|petroleum ether|essential oil|decoction|infusion|maceration|juice|powder/gi;

const MODEL_RULES = [
  ['human', /patients?|volunteers?|participants?|\bhumans?\b|\bwomen\b|\bmen\b|children|adults/i],
  ['rat', /\brats?\b|wistar|sprague/i],
  ['mouse', /\bmice\b|\bmouse\b/i],
  ['rabbit', /\brabbits?\b/i],
  ['other_animal', RULES.animal],
  ['cell_line', /cell lines?|hepg2|mcf-7|hela|\bcells\b|macrophage/i],
  ['microorganism', /bacteri|fung|strains?|isolates|plasmodium|candida|staphylococc|escherichia|salmonella|mycobacter|parasit|larva/i],
  ['chemical_assay', /\bdpph\b|frap|abts|assay|phytochemical|gc-ms|hplc|proximate|composition/i],
];

// African country names that appear in titles, mapped to ISO 3166-1 alpha-2.
// Title evidence only: a reviewer confirms or corrects it from the methods.
const COUNTRIES = {
  Nigeria: 'NG', Ghana: 'GH', Cameroon: 'CM', Benin: 'BJ', Togo: 'TG',
  'Côte d\'Ivoire': 'CI', 'Cote d\'Ivoire': 'CI', 'Ivory Coast': 'CI', Senegal: 'SN',
  Mali: 'ML', 'Burkina Faso': 'BF', Niger: 'NE', Chad: 'TD', Guinea: 'GN',
  'Sierra Leone': 'SL', Liberia: 'LR', Gambia: 'GM', Kenya: 'KE', Uganda: 'UG',
  Tanzania: 'TZ', Rwanda: 'RW', Burundi: 'BI', Ethiopia: 'ET', Sudan: 'SD',
  'South Africa': 'ZA', Zimbabwe: 'ZW', Zambia: 'ZM', Malawi: 'MW', Mozambique: 'MZ',
  Madagascar: 'MG', Congo: 'CG', 'Democratic Republic of Congo': 'CD', 'DR Congo': 'CD',
  Gabon: 'GA', Angola: 'AO', Botswana: 'BW', Namibia: 'NA', Egypt: 'EG',
  Morocco: 'MA', Algeria: 'DZ', Tunisia: 'TN', India: 'IN', Brazil: 'BR', China: 'CN',
};

function titleCountry(title) {
  // Longest names first, so "South Africa" wins over a stray match and
  // "Niger" never matches inside "Nigeria".
  const names = Object.keys(COUNTRIES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`(^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(n|ian)?([^A-Za-z]|$)`);
    if (name === 'Guinea' && /Guinea[- ]pigs?/i.test(title)) continue;
    if (pattern.test(title)) return COUNTRIES[name];
  }
  return null;
}

// The single most informative study kind, or null when the metadata cannot say.
function evidenceKind({ text, pubTypes, mesh }) {
  if (pubTypes.some(type => RULES.systematic.test(type)) || has(text, RULES.systematic)) return 'systematic_review';
  if (pubTypes.some(type => RULES.trialPubType.test(type)) || has(text, RULES.trialTitle)) return 'human_interventional';
  if (pubTypes.some(type => RULES.casePubType.test(type)) || has(text, RULES.caseTitle)) return 'case_report';
  if (has(text, RULES.humanObs)) return 'human_observational';
  if (has(text, RULES.ethno)) return 'ethnobotanical_report';
  const meshAnimal = mesh.some(term => /^(rats|mice|rabbits|animals|rats, wistar|rats, sprague-dawley|chickens|fishes|zebrafish)$/i.test(term));
  if (has(text, RULES.animal) || meshAnimal) return 'animal';
  if (has(text, RULES.inVitro)) return 'in_vitro';
  if (has(text, RULES.analytical)) return 'analytical_quality';
  return null;
}

function screening({ pubTypes, text }) {
  if (pubTypes.some(type => RULES.nonResearchPubType.test(type))) {
    return { decision: 'exclude', reason: 'not_research_publication' };
  }
  const isReview = pubTypes.some(type => RULES.reviewPubType.test(type)) || /\breview\b/i.test(text);
  if (isReview && !has(text, RULES.systematic) && !pubTypes.some(type => RULES.systematic.test(type))) {
    return { decision: 'exclude', reason: 'no_original_data' };
  }
  return null;
}

function unique(values) {
  return [...new Set(values)];
}

/**
 * @param {{title: string, keywords?: string[], mesh?: string[], pubTypes?: string[], mentionLocation: 'title'|'abstract'}} input
 */
function classify({ title, keywords = [], mesh = [], pubTypes = [], mentionLocation }) {
  const text = [title, ...keywords].join(' . ');
  const meshText = mesh.join(' . ');
  const both = `${text} . ${meshText}`;

  const screened = screening({ pubTypes, text: title });
  const kind = evidenceKind({ text, pubTypes, mesh });

  const areas = AREA_RULES.filter(([, pattern]) => pattern.test(both)).map(([area]) => area);
  const parts = unique(PART_RULES.filter(([, pattern]) => pattern.test(text)).map(([part]) => part))
    // A "root bark" match also matches "root" and "bark"; keep the specific term.
    .filter((part, _index, all) => !(part === 'root' && all.includes('root_bark'))
      && !(part === 'bark' && (all.includes('root_bark') || all.includes('stem_bark'))));
  const preparations = unique((title.match(PREPARATION) || []).map(value => value.toLowerCase()));
  const models = MODEL_RULES.filter(([, pattern]) => pattern.test(text)).map(([model]) => model);
  const model = kind === 'human_interventional' || kind === 'human_observational' || kind === 'case_report' ? 'human'
    : models.find(value => value !== 'human') ?? null;

  let decision = screened?.decision ?? (mentionLocation === 'title' ? 'include' : 'uncertain');
  const reason = screened?.reason ?? null;
  if (!screened && decision === 'include' && kind === null) decision = 'uncertain';

  return {
    screening: decision,
    exclusion_reason: reason,
    evidence_kind: kind,
    is_safety_study: has(both, RULES.safety),
    plant_part: parts.length ? parts : ['not_reported'],
    preparation: preparations.length ? preparations : ['not_reported'],
    model: model ?? 'not_reported',
    area_studied: areas.length ? areas : ['other'],
    collection_country: titleCountry(title),
  };
}

module.exports = { classify, evidenceKind, titleCountry };
