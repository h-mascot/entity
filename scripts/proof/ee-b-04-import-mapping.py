#!/usr/bin/env python3
"""Generate and validate the EE-B-04 todo.md import mapping artifacts."""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "plans"
SOURCE_CSV = DOCS / "entity-engineering-import-mapping-source.csv"
MAPPING_CSV = DOCS / "entity-engineering-import-mapping.csv"
MAPPING_MD = DOCS / "entity-engineering-import-mapping.md"
SOURCE_PACKET_SHA256 = "84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895"
TODO_SNAPSHOT_SHA256 = "e2715adba665d61f8d467a550737364f57595bef53deb73e460505d0f2842bcc"
SOURCE_CSV_SHA256 = "7b82a509440f9ff4c2ab4770722a248db9e10d185bc6f675d33318c829bda98d"
EXPECTED_ROWS = 181
EXPECTED_OPEN_ROWS = 127
EXPECTED_COMPLETED_ROWS = 54

CREATE = {
    92: ("create", "app-test", "backlog", "low", "Stable local browser fixture"),
    96: ("create", "task-product", "backlog", "medium", "Workplanes slice 1 and task hierarchy contract"),
}

VERIFY = {
    28: ("verify_then_create", "app-ui", "backlog", "low", "Confirm source patch is absent from origin/main"),
    31: ("verify_then_create", "app-ui", "backlog", "low", "Confirm source patch is absent from origin/main"),
    34: ("verify_then_create", "app-ui", "backlog", "low", "Confirm source patch is absent from origin/main"),
    39: (
        "verify_then_create",
        "delivery-infrastructure",
        "backlog",
        "high",
        "No production promotion; verify current webhook/pipeline completion semantics",
    ),
    90: (
        "verify_then_create",
        "server-build",
        "backlog",
        "medium",
        "Reproduce against current origin/main; historical error count is not authority",
    ),
}

DUPLICATES = {
    32: 31,
    41: 39,
    133: 78,
    135: 77,
    136: 79,
    137: 80,
    198: 25,
    223: 222,
    240: 34,
    244: 222,
    246: 34,
    258: 34,
    266: 255,
    276: 210,
    277: 255,
}

EXISTING = {
    78: ("THE-724+ Provider Registry graph", "provider-registry"),
    95: ("THE-863..THE-874", "workplanes-proof"),
    97: ("THE-863..THE-874", "workplanes-proof"),
    98: ("THE-873 and THE-917..THE-921", "workplanes-channels"),
    101: ("THE-900..THE-905", "scoped-search"),
    109: ("THE-896 plus Helm runtime boundary", "execution-health"),
    111: ("THE-882..THE-899", "agent-execution"),
    113: ("THE-869..THE-872", "workplanes-activity"),
    116: ("THE-876..THE-888", "agent-invites"),
    117: ("THE-882..THE-888", "agent-identity"),
    118: ("THE-889..THE-899", "execution-engine"),
    119: ("THE-912..THE-916", "auth"),
    120: ("THE-922..THE-925", "strategic"),
    121: ("THE-928 and per-UI-ticket proof gates", "proof-policy"),
    122: ("THE-898", "execution-presets"),
    169: ("THE-724+ Provider Registry graph", "provider-registry"),
    179: ("THE-724+ Provider Registry graph", "provider-registry"),
    182: ("THE-894", "execution-engine"),
    201: ("THE-724+ Provider Registry graph", "provider-registry"),
    202: ("THE-724+ Provider Registry graph", "provider-registry"),
    227: ("THE-724+ Provider Registry graph", "provider-registry"),
}

DEFERRED = {
    42: (
        "Entity/Helm boundary",
        "Reconsider only Entity-side read-only module metadata after WP2; skills, scripts, crons, and grants remain Helm-owned",
    ),
    77: ("Q47", "Security/sandbox is cross-cutting after Workplanes/engine contract"),
    79: ("Q58", "Performance dashboard waits for ActivityEvents and presence"),
    80: ("locked roadmap", "Deployment packaging is outside the current internal-loop spine"),
    88: ("locked roadmap", "Marketplace/catalog work is a later multiplier"),
    105: ("Q50", "Curacel-sourced product wedge remains discovery"),
    106: ("Q50", "Curacel-sourced product wedge remains discovery"),
    123: ("Q60", "Embedded browser pane waits until Workplanes prove the panel model"),
    124: ("Q48", "Channel panels wait for stable Workplanes and ActivityEvents"),
    125: ("Q60", "Terminal pane waits until Workplanes prove the panel model"),
    126: ("Q50", "Spatial workspace remains a product bet"),
    127: ("Q58", "Performance dashboard waits for ActivityEvents and presence"),
    129: ("Q48", "Channel adapters wait for stable Workplanes and ActivityEvents"),
    130: ("locked roadmap", "Marketplace work is not in the current Entity core queue"),
    132: ("Q47", "Security/sandbox is cross-cutting after Workplanes/engine contract"),
    191: ("Q50", "ShowClaw remains discovery"),
    192: ("Q50", "ProofDesk remains discovery"),
    197: ("Q50", "ShowClaw remains discovery"),
    218: ("Q48", "Channel adapters wait for stable Workplanes and ActivityEvents"),
    219: ("Q50", "Customer wedge remains discovery"),
    226: ("Q50", "BenchBoard is a separate product surface"),
}

MANUAL = {25, 166, 198, 203, 231, 245, 247}

HELM_OR_RUNTIME = {
    87,
    89,
    112,
    128,
    134,
    170,
    171,
    172,
    173,
    174,
    177,
    178,
    203,
    204,
    211,
    214,
    215,
    216,
    217,
    228,
    230,
    231,
    238,
    239,
    252,
    255,
    257,
    266,
    272,
    273,
    277,
}

EXTERNAL_OR_NONCODING = {
    91,
    131,
    165,
    166,
    186,
    187,
    188,
    193,
    205,
    209,
    210,
    219,
    226,
    228,
    230,
    239,
    241,
    245,
    247,
    261,
    262,
    268,
    276,
    278,
}

STALE_OR_STATUS = {
    43,
    83,
    84,
    110,
    196,
    206,
    222,
    229,
    251,
    263,
    264,
    265,
    267,
    274,
    275,
}


def normalize_title(raw: str) -> str:
    bold = re.match(r"^\*\*(.+?)\*\*", raw)
    if bold:
        title = bold.group(1)
    else:
        depth = 0
        split_at = None
        for match in re.finditer(r"\(|\)|\s+[—–]\s+", raw):
            token = match.group(0)
            if token == "(":
                depth += 1
            elif token == ")":
                depth = max(0, depth - 1)
            elif depth == 0:
                split_at = match.start()
                break
        title = raw[:split_at] if split_at is not None else raw
    title = title.replace("**", "").replace("`", "").strip()
    title = re.sub(r"[\w.+-]+@[\w.-]+", "<redacted-account>", title)
    title = re.sub(r"\s+", " ", title)
    return f"'{title}" if title.startswith(("=", "+", "-", "@")) else title


def title_key(title: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    digest = hashlib.sha256(title.lower().encode()).hexdigest()[:12]
    return f"todo-{normalized[:48].rstrip('-')}-{digest}"


def parse_qmd_export(path: Path) -> tuple[list[dict[str, str]], str]:
    source_lines: dict[int, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"(?:L\d+:)?(\d+):\s?(.*)$", raw)
        if match:
            source_lines[int(match.group(1))] = match.group(2)
    if not source_lines:
        raise ValueError(f"No numbered QMD lines found in {path}")

    section = ""
    rows: list[dict[str, str]] = []
    for line_no in sorted(source_lines):
        text = source_lines[line_no]
        if text.startswith("## "):
            section = text[3:].strip()
        match = re.match(r"- \[([ xX])\]\s+(.*)$", text)
        if not match:
            continue
        status = "completed" if match.group(1).lower() == "x" else "open"
        title = normalize_title(match.group(2))
        rows.append(
            {
                "source_line": str(line_no),
                "source_status": status,
                "source_section": section,
                "source_title": title,
                "source_fingerprint": hashlib.sha256(
                    f"{line_no}\0{status}\0{section}\0{title}".encode()
                ).hexdigest(),
            }
        )

    canonical_source = "\n".join(source_lines[n] for n in sorted(source_lines)) + "\n"
    return rows, hashlib.sha256(canonical_source.encode()).hexdigest()


def classify(row: dict[str, str]) -> dict[str, str]:
    line = int(row["source_line"])
    empty = {
        "import_action": "none",
        "canonical_source_line": "",
        "stable_title_key": "",
        "target_project_key": "",
        "target_state": "",
        "target_lane": "",
        "existing_linear": "",
        "risk": "none",
        "prerequisite": "",
    }
    if row["source_status"] == "completed":
        return {**empty, "disposition": "exclude_completed", "rationale": "Source checkbox is completed"}
    if line in DUPLICATES:
        canonical = DUPLICATES[line]
        return {
            **empty,
            "disposition": "merge_duplicate",
            "canonical_source_line": str(canonical),
            "rationale": f"Duplicate/status variant of source line {canonical}",
        }
    if line in CREATE or line in VERIFY:
        action, lane, state, risk, prerequisite = (CREATE | VERIFY)[line]
        return {
            **empty,
            "disposition": "import_candidate",
            "import_action": action,
            "canonical_source_line": str(line),
            "stable_title_key": title_key(row["source_title"]),
            "target_project_key": "entity-engineering",
            "target_state": state,
            "target_lane": lane,
            "risk": risk,
            "prerequisite": prerequisite,
            "rationale": "Actionable Entity repository or delivery-infrastructure engineering work",
        }
    if line in EXISTING:
        linear, lane = EXISTING[line]
        return {
            **empty,
            "disposition": "link_existing_linear",
            "target_lane": lane,
            "existing_linear": linear,
            "risk": "inherit",
            "rationale": "Already represented in the approved Linear/source-packet graph",
        }
    if line in DEFERRED:
        authority, reason = DEFERRED[line]
        return {
            **empty,
            "disposition": "defer_by_roadmap",
            "target_lane": "future-discovery",
            "prerequisite": authority,
            "rationale": reason,
        }
    if line in MANUAL:
        return {
            **empty,
            "disposition": "exclude_manual_or_destructive",
            "risk": "high",
            "rationale": "Requires manual credentials, production data, or destructive operator action",
        }
    if line in HELM_OR_RUNTIME:
        return {
            **empty,
            "disposition": "route_external_runtime_owner",
            "target_lane": "helm-or-runtime",
            "risk": "inherit",
            "rationale": "Deep runtime/provider/config ownership is outside Entity core",
        }
    if line in EXTERNAL_OR_NONCODING:
        return {
            **empty,
            "disposition": "exclude_external_or_noncoding",
            "rationale": "Separate product/repository, operator note, or documentation-only work",
        }
    if line in STALE_OR_STATUS:
        return {
            **empty,
            "disposition": "exclude_stale_or_status",
            "rationale": "Source notes show completed/superseded status or a non-actionable status card",
        }
    raise ValueError(f"Open source line {line} has no explicit disposition: {row['source_title']}")


MAPPING_FIELDS = [
    "source_line",
    "source_status",
    "source_section",
    "source_title",
    "source_fingerprint",
    "disposition",
    "import_action",
    "canonical_source_line",
    "stable_title_key",
    "target_project_key",
    "target_state",
    "target_lane",
    "existing_linear",
    "risk",
    "prerequisite",
    "rationale",
]


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def render_mapping_markdown(mappings: list[dict[str, str]], todo_sha: str) -> str:
    counts = Counter(row["disposition"] for row in mappings)
    candidates = [row for row in mappings if row["disposition"] == "import_candidate"]
    lines = [
        "# Entity Engineering todo.md import mapping",
        "",
        "## Authority and safety",
        "",
        f"- Linear: THE-852 / EE-B-04; dependency THE-851 is Done.",
        f"- Consolidated source packet SHA-256: `{SOURCE_PACKET_SHA256}`.",
        f"- Retrieved QMD todo snapshot SHA-256: `{todo_sha}`.",
        f"- Coverage: {len(mappings)} checklist rows ({sum(r['source_status'] == 'open' for r in mappings)} open, {sum(r['source_status'] == 'completed' for r in mappings)} completed).",
        "- This artifact is plan-only: it creates no task, writes no database, and performs no production promotion.",
        "- Raw todo notes are intentionally not copied; the CSV retains sanitized titles, source lines, sections, and fingerprints.",
        "",
        "## Deterministic rules",
        "",
        "1. Every checklist row receives exactly one disposition; unmatched open rows fail generation.",
        "2. Completed rows are excluded. Exact duplicates/status variants merge into one canonical source line.",
        "3. Loaded Linear/source-packet work links to existing issues instead of creating duplicates.",
        "4. Deep runtime/provider/config work routes to Helm or its owning runtime; manual OAuth/destructive work is excluded.",
        "5. Q47/Q48/Q50/Q58/Q60 deferrals remain deferred; Q62+ is not authority.",
        "6. Import candidates use `entity-engineering`, backlog state, and a title-derived SHA-256 key.",
        "7. `verify_then_create` candidates must be checked against current `origin/main` and existing Linear titles before creation.",
        "8. No manual OAuth, destructive-data, or production-only item is eligible for import.",
        "",
        "## Disposition totals",
        "",
        "| Disposition | Rows |",
        "|---|---:|",
    ]
    lines.extend(f"| `{name}` | {count} |" for name, count in sorted(counts.items()))
    lines.extend(
        [
            "",
            "## Canonical import candidates",
            "",
            "| Source | Candidate | Action | Lane | Risk | Stable key | Prerequisite |",
            "|---:|---|---|---|---|---|---|",
        ]
    )
    for row in candidates:
        lines.append(
            f"| {row['source_line']} | {row['source_title']} | `{row['import_action']}` | "
            f"`{row['target_lane']}` | `{row['risk']}` | `{row['stable_title_key']}` | "
            f"{row['prerequisite']} |"
        )
    lines.extend(
        [
            "",
            "## Landing protocol for EE-B-05/06",
            "",
            "1. EE-B-05 reads only rows with `disposition=import_candidate` and performs a no-write dry run.",
            "2. Scope every key as `(project_id, source_system='entity-todo', source_key)`; title/fuzzy matching is advisory only.",
            "3. Revalidate `verify_then_create` rows against current source and close them as stale if already landed.",
            "4. EE-B-06 must add an import ledger with a database `UNIQUE(project_id, source_system, source_key)` constraint.",
            "5. Create the task, its `task_import_keys` ledger row, and `metadata.engineering_import` provenance in one transaction.",
            "6. A unique conflict returns the ledger-linked task; the importer must never use `create_anyway`.",
            "7. Preserve source line, source fingerprint, todo snapshot SHA, mapping SHA, and import actor in provenance.",
            "8. Use append-only receipt identity `ee-b-06:<todo_sha>:<mapping_sha>:<approved_set_sha>`; never overwrite a prior receipt.",
            "9. Refuse unresolved project identity, changed source/mapping hash, prerequisite failure, or ledger/task drift.",
            "",
            "Required future ledger shape:",
            "",
            "```sql",
            "CREATE TABLE task_import_keys (",
            "  project_id INTEGER NOT NULL,",
            "  source_system TEXT NOT NULL,",
            "  source_key TEXT NOT NULL,",
            "  task_id INTEGER NOT NULL UNIQUE,",
            "  source_fingerprint TEXT NOT NULL,",
            "  source_snapshot_sha256 TEXT NOT NULL,",
            "  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,",
            "  UNIQUE(project_id, source_system, source_key)",
            ");",
            "```",
            "",
            "Full row-level decisions are in `entity-engineering-import-mapping.csv`; normalized source identity is in "
            "`entity-engineering-import-mapping-source.csv`.",
            "",
        ]
    )
    return "\n".join(lines)


def generate(qmd_export: Path) -> None:
    rows, todo_sha = parse_qmd_export(qmd_export)
    if todo_sha != TODO_SNAPSHOT_SHA256:
        raise ValueError(
            f"QMD todo snapshot changed: expected {TODO_SNAPSHOT_SHA256}, received {todo_sha}"
        )
    mappings = [{**row, **classify(row)} for row in rows]
    write_csv(SOURCE_CSV, rows, list(rows[0]))
    write_csv(MAPPING_CSV, mappings, MAPPING_FIELDS)
    MAPPING_MD.write_text(render_mapping_markdown(mappings, todo_sha), encoding="utf-8")
    validate()
    candidates = [row for row in mappings if row["disposition"] == "import_candidate"]
    print(f"PASS generated {len(mappings)} rows; import_candidates={len(candidates)}; todo_sha256={todo_sha}")


def validate() -> None:
    source_csv_sha = hashlib.sha256(SOURCE_CSV.read_bytes()).hexdigest()
    if source_csv_sha != SOURCE_CSV_SHA256:
        raise ValueError(
            f"Normalized source snapshot changed: expected {SOURCE_CSV_SHA256}, received {source_csv_sha}"
        )
    with SOURCE_CSV.open(encoding="utf-8", newline="") as handle:
        source_rows = list(csv.DictReader(handle))
    with MAPPING_CSV.open(encoding="utf-8", newline="") as handle:
        mappings = list(csv.DictReader(handle))

    open_rows = sum(row["source_status"] == "open" for row in source_rows)
    completed_rows = sum(row["source_status"] == "completed" for row in source_rows)
    if (
        len(source_rows) != EXPECTED_ROWS
        or open_rows != EXPECTED_OPEN_ROWS
        or completed_rows != EXPECTED_COMPLETED_ROWS
    ):
        raise ValueError(
            f"Unexpected source coverage: rows={len(source_rows)} open={open_rows} completed={completed_rows}"
        )
    if len(source_rows) != len(mappings):
        raise ValueError("Source/mapping row count mismatch")
    if len({row["source_line"] for row in mappings}) != len(mappings):
        raise ValueError("Duplicate source_line in mapping")
    if any(not row["disposition"] for row in mappings):
        raise ValueError("Mapping contains blank disposition")
    if {
        (row["source_line"], row["source_fingerprint"]) for row in source_rows
    } != {
        (row["source_line"], row["source_fingerprint"]) for row in mappings
    }:
        raise ValueError("Source/mapping fingerprints differ")
    expected_mappings = [{**row, **classify(row)} for row in source_rows]
    if mappings != expected_mappings:
        raise ValueError("Mapping CSV differs from deterministic classification output")
    expected_markdown = render_mapping_markdown(expected_mappings, TODO_SNAPSHOT_SHA256)
    if MAPPING_MD.read_text(encoding="utf-8") != expected_markdown:
        raise ValueError("Mapping Markdown differs from deterministic render output")
    if any(
        row["source_title"].startswith(("=", "+", "-", "@"))
        for row in source_rows
    ):
        raise ValueError("CSV formula-like source title is not neutralized")

    candidates = [row for row in expected_mappings if row["disposition"] == "import_candidate"]
    keys = [row["stable_title_key"] for row in candidates]
    if not keys or len(keys) != len(set(keys)) or any(not key for key in keys):
        raise ValueError("Import candidate stable keys are blank or duplicated")
    if any(row["target_project_key"] != "entity-engineering" for row in candidates):
        raise ValueError("Import candidate targets a non-Engineering project")
    if any(row["target_state"] != "backlog" for row in candidates):
        raise ValueError("Import candidate is not planned for backlog state")
    if any(
        row["disposition"] == "route_external_runtime_owner" and row["target_project_key"]
        for row in expected_mappings
    ):
        raise ValueError("Runtime-owned item leaked into Entity Engineering import")

    duplicates = [row for row in expected_mappings if row["disposition"] == "merge_duplicate"]
    rows_by_line = {row["source_line"]: row for row in expected_mappings}
    source_lines = set(rows_by_line)
    if any(row["canonical_source_line"] not in source_lines for row in duplicates):
        raise ValueError("Duplicate points at a missing canonical source line")
    if any(
        rows_by_line[row["canonical_source_line"]]["disposition"] == "merge_duplicate"
        for row in duplicates
    ):
        raise ValueError("Duplicate points at another duplicate instead of a canonical row")

    print(
        f"PASS coverage={len(expected_mappings)} open={open_rows} "
        f"completed={completed_rows} "
        f"import_candidates={len(candidates)} unique_keys={len(set(keys))}"
    )


def self_test() -> None:
    unknown = {
        "source_line": "999",
        "source_status": "open",
        "source_section": "test",
        "source_title": "Unclassified coding item",
        "source_fingerprint": "test",
    }
    try:
        classify(unknown)
    except ValueError as error:
        if "no explicit disposition" not in str(error):
            raise
    else:
        raise ValueError("Unknown open row did not fail closed")

    redacted = normalize_title("OAuth expired for person@example.com — manual action")
    if redacted != "OAuth expired for <redacted-account>":
        raise ValueError("Account redaction self-test failed")
    parenthetical = normalize_title("Strategic tab (roadmaps — recurring tasks)")
    if parenthetical != "Strategic tab (roadmaps — recurring tasks)":
        raise ValueError("Parenthetical title normalization self-test failed")
    if normalize_title("=IMPORTDATA(example)") != "'=IMPORTDATA(example)":
        raise ValueError("CSV formula neutralization self-test failed")
    if title_key("Stable title") != title_key("Stable title"):
        raise ValueError("Stable title key is not deterministic")
    validate()
    print(
        "PASS negative_path=unknown_open_row_rejected "
        "account_redaction=verified formula_neutralization=verified"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate-from-qmd-export", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.generate_from_qmd_export:
        generate(args.generate_from_qmd_export)
    elif args.self_test:
        self_test()
    else:
        validate()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
