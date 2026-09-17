#!/usr/bin/env python3
"""Reproduce the minimally transformed plant-source staging files.

Requires pdfplumber. The XML inputs are NLM/JATS full text; the Port Harcourt
input is the table captured from the publisher's rendered HTML.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
SURVEYS = ROOT / "data" / "plants" / "surveys"


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def cell_text(cell) -> str:
    return clean("".join(cell.itertext()))


def cells(row) -> list[str]:
    return [cell_text(cell) for cell in list(row) if cell.tag.rsplit("}", 1)[-1] in {"td", "th"}]


def table(root, label: str):
    for wrapped in root.findall(".//table-wrap"):
        label_node = wrapped.find("label")
        if label_node is not None and cell_text(label_node) == label:
            return wrapped
    raise ValueError(f"Missing {label}")


def split_parts(value: str) -> list[str]:
    if not clean(value) or clean(value) in {"—", "-"}:
        return []
    return [clean(part).lower() for part in re.split(r"[,;/]", value) if clean(part)]


def split_names(value: str, default_language: str) -> list[dict]:
    value = clean(value)
    if not value or value.lower() in {"n.a", "n/a", "nil", "none", "—", "-"}:
        return []
    output = []
    for raw_name in re.split(r"[;,]", value):
        name = clean(raw_name)
        if not name:
            continue
        language = default_language
        language_match = re.search(r"\((hausa|yoruba|igbo|ibo|fulani)\)\s*$", name, re.I)
        if language_match:
            language = {
                "hausa": "ha",
                "yoruba": "yo",
                "igbo": "ig",
                "ibo": "ig",
                "fulani": "ff",
            }[language_match.group(1).lower()]
            name = clean(name[: language_match.start()])
        if name:
            output.append({"local_name": name, "language": language})
    return output


def words_to_text(words: list[dict]) -> str:
    lines: list[list[dict]] = []
    for word in sorted(words, key=lambda item: (round(item["top"], 1), item["x0"])):
        if not lines or abs(lines[-1][0]["top"] - word["top"]) > 2.5:
            lines.append([word])
        else:
            lines[-1].append(word)
    return clean(" ".join(" ".join(item["text"] for item in sorted(line, key=lambda item: item["x0"])) for line in lines))


def extract_lagos(pdf_path: Path) -> list[dict]:
    rows = []
    with pdfplumber.open(pdf_path) as document:
        for page in document.pages[:12]:
            words = page.extract_words(x_tolerance=1, y_tolerance=2, keep_blank_chars=False)
            serial_words = sorted(
                [word for word in words if word["x0"] < 105 and re.fullmatch(r"\d{1,3}", word["text"])],
                key=lambda word: word["top"],
            )
            for index, serial_word in enumerate(serial_words):
                serial = int(serial_word["text"])
                if not 1 <= serial <= 183:
                    continue
                top = serial_word["top"] - 1
                bottom = serial_words[index + 1]["top"] - 1 if index + 1 < len(serial_words) else page.height - 20
                row_words = [word for word in words if top <= word["top"] < bottom]
                columns = {
                    "botanical": words_to_text([word for word in row_words if 105 <= word["x0"] < 346]),
                    "family": words_to_text([word for word in row_words if 346 <= word["x0"] < 438]),
                    "local": words_to_text([word for word in row_words if 438 <= word["x0"] < 566]),
                    "voucher": words_to_text([word for word in row_words if 566 <= word["x0"] < 651]),
                    "parts": words_to_text([word for word in row_words if 651 <= word["x0"] < 728]),
                    "life_form": words_to_text([word for word in row_words if word["x0"] >= 728]),
                }
                columns["life_form"] = re.sub(
                    rf"\s+{page.page_number}$", "", columns["life_form"]
                ).strip()
                rows.append(
                    {
                        "source_id": "olanipekun-2022-lagos",
                        "source_row": serial,
                        "botanical_as_published": columns["botanical"],
                        "family_as_published": columns["family"],
                        "common_english_as_published": None,
                        "vernacular_as_published": columns["local"],
                        "vernacular_names": split_names(columns["local"], "yo"),
                        "parts_reported": split_parts(columns["parts"]),
                        "voucher_specimen": columns["voucher"] or None,
                        "life_form_as_published": columns["life_form"] or None,
                        "use_context": "medicinal plant reported in five Lagos State communities",
                    }
                )
    rows.sort(key=lambda row: row["source_row"])
    serials = [row["source_row"] for row in rows]
    if serials != list(range(1, 184)):
        raise ValueError(f"Lagos extraction produced non-contiguous serials: {serials}")
    return rows


def extract_anti_asthmatic(pdf_path: Path) -> list[dict]:
    with pdfplumber.open(pdf_path) as document:
        extracted = document.pages[3].extract_tables()[0]
    data = extracted[1]
    columns = [[clean(item) for item in (column or "").split("\n") if clean(item)] for column in data]
    if any(len(column) != 46 for column in columns):
        raise ValueError(f"Expected 46 anti-asthmatic rows, got {[len(column) for column in columns]}")
    output = []
    for index in range(46):
        output.append(
            {
                "source_id": "sonibare-2008-anti-asthmatic",
                "source_row": index + 1,
                "botanical_as_published": columns[1][index],
                "family_as_published": columns[2][index],
                "common_english_as_published": None,
                "vernacular_as_published": columns[3][index],
                "vernacular_names": split_names(columns[3][index], "yo"),
                "parts_reported": split_parts(columns[4][index]),
                "voucher_specimen": None,
                "use_context": "traditional anti-asthmatic plant report in southwestern Nigeria",
            }
        )
    return output


def extract_ile_ife(xml_path: Path) -> dict:
    root = ET.parse(xml_path).getroot()
    inventory_rows = table(root, "Table 1").findall(".//tr")[1:]
    inventory = []
    for index, row in enumerate(inventory_rows, 1):
        values = cells(row)
        if len(values) != 8:
            raise ValueError(f"Unexpected Ile-Ife inventory row {index}: {values}")
        inventory.append(
            {
                "source_id": "mukaila-2021-ile-ife",
                "source_row": index,
                "botanical_as_published": values[0],
                "family_as_published": values[1],
                "common_english_as_published": values[2] or None,
                "vernacular_as_published": values[3],
                "vernacular_names": split_names(values[3], "yo"),
                "voucher_specimen": values[4] or None,
                "life_form_as_published": values[5] or None,
                "frequency_as_published": values[6] or None,
                "relative_frequency_as_published": values[7] or None,
            }
        )

    observations = []
    current = None
    for source_row, row in enumerate(table(root, "Table 2").findall(".//tr")[1:], 1):
        values = cells(row)
        if len(values) == 6:
            current = values[0]
            observations.append(
                {
                    "source_row": source_row,
                    "botanical_as_published": current,
                    "source_as_published": values[1],
                    "parts_reported": split_parts(values[2]),
                    "preparation_and_use_as_published": values[3],
                    "use_reports_as_published": values[4],
                    "cultural_importance_index_as_published": values[5],
                }
            )
        elif len(values) == 1 and current:
            observations.append(
                {
                    "source_row": source_row,
                    "botanical_as_published": current,
                    "source_as_published": None,
                    "parts_reported": [],
                    "preparation_and_use_as_published": values[0],
                    "use_reports_as_published": None,
                    "cultural_importance_index_as_published": None,
                }
            )
        else:
            raise ValueError(f"Unexpected Ile-Ife use row {source_row}: {values}")
    if len(inventory) != 87:
        raise ValueError(f"Expected 87 Ile-Ife inventory rows, got {len(inventory)}")
    return {
        "source_id": "mukaila-2021-ile-ife",
        "publication_status": "retracted",
        "runtime_export_eligible": False,
        "inventory": inventory,
        "observations": observations,
    }


def extract_review(xml_path: Path) -> dict:
    root = ET.parse(xml_path).getroot()
    publications = []
    for index, row in enumerate(table(root, "Table 2").findall(".//tr")[1:], 1):
        values = cells(row)
        if len(values) != 9:
            raise ValueError(f"Unexpected review catalogue row {index}: {values}")
        publications.append(
            {
                "source_row": index,
                "serial_as_published": values[0],
                "authors_as_published": values[1],
                "title": values[2],
                "nigerian_region_as_published": values[3],
                "method_as_published": values[4],
                "plant_count_as_published": values[5],
                "family_count_as_published": values[6],
                "participants_as_published": values[7],
                "voucher_as_published": values[8],
            }
        )

    prominent_rows = []
    current_scientific = None
    current_local = None
    for source_row, row in enumerate(table(root, "Table 3").findall(".//tr")[1:], 1):
        values = cells(row)
        if len(values) == 8:
            current_scientific, state, current_local, use, part, preparation, administration, references = values
        elif len(values) == 6:
            state, use, part, preparation, administration, references = values
        elif len(values) == 7 and re.match(r"^[A-Z][a-z-]+\s+[a-z]", values[0]):
            current_scientific = values[0]
            current_local = None
            continue
        elif len(values) == 7 and not values[0]:
            state, use, part, preparation, administration, references = values[1:]
        elif len(values) == 7:
            state, current_local, use, part, preparation, administration, references = values
        else:
            raise ValueError(f"Unexpected review prominent-plant row {source_row}: {values}")
        prominent_rows.append(
            {
                "source_row": source_row,
                "scientific_name_and_family_as_published": current_scientific,
                "local_names_as_published": current_local or None,
                "nigerian_state_as_published": state,
                "ethnobotanical_use_as_published": use,
                "plant_part_as_published": part,
                "preparation_as_published": preparation,
                "administration_as_published": administration,
                "references_as_published": references,
            }
        )
    if len(publications) != 79:
        raise ValueError(f"Expected 79 review catalogue rows, got {len(publications)}")
    return {
        "source_id": "anumudu-2025-nigeria-review",
        "runtime_export_eligible": False,
        "original_study_catalogue": publications,
        "secondary_prominent_plant_observations": prominent_rows,
    }


def extract_port_harcourt(json_path: Path) -> list[dict]:
    rows = json.loads(json_path.read_text())
    output = []
    for index, values in enumerate(rows, 1):
        if len(values) != 9:
            raise ValueError(f"Unexpected Port Harcourt row {index}: {values}")
        serial, common, botanical, family, yoruba, igbo, hausa, uses, parts = map(clean, values)
        flags = []
        if not serial:
            flags.append("unnumbered_source_row")
        if index == 48 and botanical.lower().startswith("neem tree"):
            flags.append("common_and_botanical_columns_appear_swapped")
        names = []
        for published, language in ((yoruba, "yo"), (igbo, "ig"), (hausa, "ha")):
            names.extend(split_names(published, language))
        output.append(
            {
                "source_id": "weli-2013-port-harcourt",
                "source_row": index,
                "serial_as_published": serial or None,
                "botanical_as_published": botanical or None,
                "family_as_published": family or None,
                "common_english_as_published": common or None,
                "vernacular_as_published": {"yo": yoruba or None, "ig": igbo or None, "ha": hausa or None},
                "vernacular_names": names,
                "parts_reported": split_parts(parts),
                "traditional_use_as_published": uses or None,
                "data_quality_flags": flags,
                "runtime_export_eligible": False,
            }
        )
    if len(output) != 84:
        raise ValueError(f"Expected 84 displayed Port Harcourt rows, got {len(output)}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lagos-pdf", type=Path, required=True)
    parser.add_argument("--anti-asthmatic-pdf", type=Path, required=True)
    parser.add_argument("--ile-ife-xml", type=Path, required=True)
    parser.add_argument("--review-xml", type=Path, required=True)
    parser.add_argument("--port-harcourt-json", type=Path, required=True)
    args = parser.parse_args()

    lagos = extract_lagos(args.lagos_pdf)
    anti = extract_anti_asthmatic(args.anti_asthmatic_pdf)
    ile_ife = extract_ile_ife(args.ile_ife_xml)
    review = extract_review(args.review_xml)
    port = extract_port_harcourt(args.port_harcourt_json)

    write_json(SURVEYS / "olanipekun-2022-lagos.json", lagos)
    write_json(SURVEYS / "sonibare-2008-anti-asthmatic.json", anti)
    write_json(SURVEYS / "staged" / "weli-2013-port-harcourt.json", port)
    write_json(SURVEYS / "quarantine" / "mukaila-2021-ile-ife-retracted.json", ile_ife)
    write_json(SURVEYS / "discovery" / "anumudu-2025-nigeria-review.json", review)
    print(
        json.dumps(
            {
                "lagos_rows": len(lagos),
                "anti_asthmatic_rows": len(anti),
                "port_harcourt_displayed_rows_staged": len(port),
                "ile_ife_inventory_rows_quarantined": len(ile_ife["inventory"]),
                "review_original_studies_catalogued": len(review["original_study_catalogue"]),
                "review_secondary_observations_staged": len(review["secondary_prominent_plant_observations"]),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
