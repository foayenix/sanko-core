#!/usr/bin/env python3
"""Extract concise, language-labelled mapping facts from the supplied books.

The output intentionally excludes therapeutic prose. Both books are copyrighted,
so this script retains only bibliographic metadata, short factual mappings, and
page locators needed for internal verification.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "plants" / "references" / "staged"

LANGUAGE_CODES = {
    "akan": "ak",
    "akan (twi)": "ak",
    "afrikaans": "af",
    "arabic": "ar",
    "bambara": "bm",
    "bini": "bin",
    "efik": "efi",
    "ewe": "ee",
    "fulani": "ff",
    "fulfulde": "ff",
    "hausa": "ha",
    "ibibio": "ibb",
    "igbo": "ig",
    "kanuri": "kr",
    "kiswahili": "sw",
    "swahili": "sw",
    "twi": "ak",
    "wolof": "wo",
    "yoruba": "yo",
}

REGION_LABELS = {
    "africa",
    "angola",
    "cameroon",
    "congo",
    "ghana",
    "ivory coast",
    "kenya",
    "mozambique",
    "namibia",
    "nigeria",
    "south africa",
    "sudan",
    "tanzania",
    "uganda",
    "west africa",
    "zanzibar",
    "zimbabwe",
}

FIELD_START = re.compile(
    r"^(?:Description|Habitat and Distribution|Geographical Distribution|Ethnomedicinal Uses|"
    r"Medicinal Uses|Constituents|Pharmacological Studies|Pharmacology|Toxicity|Agriculture|"
    r"Commerce|Formulation and Dosage Forms|Clinical Properties|Related Species|Uses, Constituents)\b"
)


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalized(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    plain = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^\w]+", " ", plain.lower(), flags=re.UNICODE).strip()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def is_running_header(line: str) -> bool:
    lowered = line.lower()
    return (
        "taylor & francis group" in lowered
        or ("handbook of" in lowered and "plants" in lowered)
        or ("profile of" in lowered and "phar" in lowered and "plants" in lowered)
        or bool(re.fullmatch(r"\d{1,3}", line))
    )


def split_outside_parentheses(value: str) -> list[str]:
    output = []
    start = 0
    depth = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")" and depth:
            depth -= 1
        elif char == "," and depth == 0:
            output.append(value[start:index])
            start = index + 1
    output.append(value[start:])
    return [clean(item).strip(" .") for item in output if clean(item).strip(" .")]


def region_from_label(label: str) -> str | None:
    lowered = label.lower()
    if any(region in lowered for region in REGION_LABELS):
        return label
    return None


def parse_labelled_names(block: str) -> tuple[list[dict], list[str]]:
    block = re.sub(r"(?<=[a-z])\s*-\s*(?=[a-z])", "-", clean(block))
    flags = []
    segments = [clean(segment) for segment in block.split(";") if clean(segment)]
    parsed = []
    for segment in segments:
        if ":" not in segment:
            flags.append("unlabelled_name_segment")
            continue
        label, values = [clean(item) for item in segment.split(":", 1)]
        nested = re.match(r"([A-Z][A-Za-z ()'-]+):\s*(.+)", values)
        if nested:
            label, values = nested.group(1), nested.group(2)
            flags.append("nested_language_label_recovered")
        label_key = label.lower()
        base_label = clean(re.sub(r"\([^)]*\)", "", label_key))
        language = LANGUAGE_CODES.get(label_key) or LANGUAGE_CODES.get(base_label)
        for local_name in split_outside_parentheses(values):
            if len(local_name) > 80 or re.search(r"\b(?:the names|classification|taxonomic)\b", local_name, re.I):
                flags.append("prose_like_name_segment_excluded")
                continue
            key = (normalized(local_name), language, label.lower())
            if not key[0]:
                continue
            parsed.append(
                {
                    "local_name": local_name,
                    "normalized_name": key[0],
                    "language": language,
                    "language_or_group_as_published": label,
                    "region_as_published": region_from_label(label),
                    "region": {"country": "Nigeria", "state": None, "localities": []}
                    if "nigeria" in label.lower()
                    else None,
                }
            )
    unique = []
    seen = set()
    for item in parsed:
        key = (item["normalized_name"], item["language"], item["language_or_group_as_published"].lower())
        if key not in seen:
            unique.append(item)
            seen.add(key)
    return unique, sorted(set(flags))


def field_value(lines: list[tuple[int, str]], patterns: list[re.Pattern]) -> tuple[str | None, int | None]:
    for index, (page, line) in enumerate(lines):
        match = next((pattern.search(line) for pattern in patterns if pattern.search(line)), None)
        if not match:
            continue
        parts = [match.group(1)]
        for _, following in lines[index + 1 :]:
            if FIELD_START.match(following) or re.match(
                r"^[A-Z][A-Za-z0-9 ,/&()'-]{1,60}\s+(?:—|are)\s*", following
            ):
                break
            parts.append(following)
        return clean(" ".join(parts)), page
    return None, None


def extract_iwu(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    entries = []
    current = None
    for pdf_page in range(126, 355):
        page_text = reader.pages[pdf_page - 1].extract_text() or ""
        for raw_line in page_text.splitlines():
            line = clean(raw_line)
            if not line or is_running_header(line):
                continue
            match = re.match(r"Botanical Name\s*—\s*(.+)", line)
            if match:
                if current:
                    entries.append(current)
                current = {
                    "botanical_as_published": clean(match.group(1)),
                    "botanical_pdf_page": pdf_page,
                    "lines": [],
                }
            elif current:
                current["lines"].append((pdf_page, line))
    if current:
        entries.append(current)

    records = []
    for source_row, entry in enumerate(entries, 1):
        lines = entry.pop("lines")
        while entry["botanical_as_published"].endswith("-") and lines:
            continuation_page, continuation = lines[0]
            if re.match(r"^[A-Z][A-Za-z ]+\s+—", continuation):
                break
            entry["botanical_as_published"] = (
                entry["botanical_as_published"][:-1] + continuation
            )
            lines.pop(0)
        family, _ = field_value(lines, [re.compile(r"^Family\s*—\s*(.+)")])
        common, _ = field_value(lines, [re.compile(r"^Common Names?\s*—\s*(.+)")])
        names, names_page = field_value(
            lines,
            [
                re.compile(r"^African Names?\s*—\s*(.+)"),
                re.compile(r"^Local Names?\s*—\s*(.+)"),
                re.compile(r"^Common Names and African Names are similar in most cases:\s*(.+)"),
            ],
        )
        vernacular_names, quality_flags = parse_labelled_names(names) if names else ([], [])
        if not names:
            quality_flags.append("no_labelled_vernacular_names_in_monograph")
        records.append(
            {
                "source_id": "iwu-2014-african-medicinal-plants",
                "source_row": source_row,
                "botanical_as_published": entry["botanical_as_published"],
                "family_as_published": family,
                "common_names_as_published": common,
                "vernacular_as_published": names,
                "vernacular_names": vernacular_names,
                "source_locator": {
                    "section": "Chapter 3: Pharmacognostical Profile of Selected Medicinal Plants",
                    "botanical_pdf_page": entry["botanical_pdf_page"],
                    "botanical_printed_page": entry["botanical_pdf_page"] - 15,
                    "vernacular_pdf_page": names_page,
                    "vernacular_printed_page": names_page - 15 if names_page else None,
                },
                "verification_status": "source_transcribed",
                "runtime_export_eligible": False,
                "data_quality_flags": sorted(set(quality_flags)),
            }
        )

    return {
        "source_id": "iwu-2014-african-medicinal-plants",
        "copyright_status": "copyrighted",
        "runtime_export_eligible": False,
        "extraction_scope": "short botanical, common-name, and labelled African-name facts from Chapter 3 only",
        "records": records,
    }


def describe_oliver_bever(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    return {
        "source_id": "oliver-bever-1986-tropical-west-africa",
        "copyright_status": "copyrighted",
        "runtime_export_eligible": False,
        "pdf_pages": len(reader.pages),
        "printed_botanical_and_general_index_pages": "355-367",
        "pdf_botanical_and_general_index_pages": "356-376",
        "structured_vernacular_mappings_extracted": 0,
        "notes": "The book has a botanical/general index, not a structured language-labelled vernacular index. It is retained as botanical and pharmacological reference evidence; local-name mappings must come from a source that states the language and locality.",
    }


def annotate_existing_evidence(iwu: dict) -> dict:
    existing_path = ROOT / "data" / "plants" / "vernacular_names.json"
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else []
    by_name_language: dict[tuple[str, str | None], set[str]] = {}
    for name in existing:
        if not name.get("accepted_botanical"):
            continue
        key = (name["normalized_name"], name.get("language"))
        by_name_language.setdefault(key, set()).add(name["accepted_botanical"])

    counts = {"corroborates_existing": 0, "conflicts_with_existing": 0, "not_in_existing_rich_data": 0}
    target_counts = dict(counts)
    for record in iwu["records"]:
        binomial_match = re.match(r"^([A-Z][A-Za-z-]+\s+[a-z][A-Za-z-]+)", record["botanical_as_published"])
        binomial = binomial_match.group(1) if binomial_match else None
        for name in record["vernacular_names"]:
            candidates = sorted(by_name_language.get((name["normalized_name"], name["language"]), set()))
            if not candidates:
                status = "not_in_existing_rich_data"
            elif binomial and binomial in candidates:
                status = "corroborates_existing"
            else:
                status = "conflicts_with_existing"
            name["existing_mapping_status"] = status
            name["existing_accepted_botanicals"] = candidates
            counts[status] += 1
            if name["language"] in {"ha", "ig", "yo"}:
                target_counts[status] += 1
    return {
        "all_language_labelled_facts": counts,
        "hausa_igbo_yoruba_facts": target_counts,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iwu-pdf", type=Path, required=True)
    parser.add_argument("--oliver-bever-pdf", type=Path, required=True)
    args = parser.parse_args()

    iwu = extract_iwu(args.iwu_pdf)
    oliver = describe_oliver_bever(args.oliver_bever_pdf)
    cross_reference = annotate_existing_evidence(iwu)
    write_json(OUTPUT / "iwu-2014-african-medicinal-plants.json", iwu)
    write_json(OUTPUT / "oliver-bever-1986-tropical-west-africa.json", oliver)
    write_json(
        OUTPUT / "book-reference-report.json",
        {
            "generated_at": "2026-08-13",
            "runtime_changed": False,
            "reason": "Copyright, missing row-specific locality, and pending language review keep these facts staged.",
            "iwu_cross_reference": cross_reference,
            "oliver_bever_structured_vernacular_mappings": 0,
        },
    )

    records = iwu["records"]
    names = [name for record in records for name in record["vernacular_names"]]
    print(
        json.dumps(
            {
                "iwu_monographs": len(records),
                "iwu_monographs_with_labelled_names": sum(bool(record["vernacular_names"]) for record in records),
                "iwu_language_labelled_name_facts": len(names),
                "iwu_hausa_igbo_yoruba_name_facts": sum(name["language"] in {"ha", "ig", "yo"} for name in names),
                "iwu_cross_reference": cross_reference,
                "oliver_bever_structured_vernacular_mappings": 0,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
