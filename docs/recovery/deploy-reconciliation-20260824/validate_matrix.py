#!/usr/bin/env python3
"""Validate recovery-matrix.json against live Git facts.

Run from anywhere inside the recovery worktree:
    python3 docs/recovery/deploy-reconciliation-20260824/validate_matrix.py

Checks per line: tip exists, merge-base matches `git merge-base`,
ahead/behind counts vs baseline, changed-file lists (name+status),
and commit lists (sha|subject, oldest-first) all match the matrix.
Exit 0 = all valid; exit 1 = any mismatch (printed).
"""
import json
import subprocess
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
MATRIX_PATH = DOCS / "recovery-matrix.json"


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def main() -> int:
    matrix = json.loads(MATRIX_PATH.read_text())
    baseline = matrix["baseline"]["sha"]
    failures = []

    if not subprocess.run(
        ["git", "cat-file", "-e", baseline], capture_output=True
    ).returncode == 0:
        failures.append(f"baseline {baseline} missing")

    for name, line in matrix["lines"].items():
        tip, mb = line["tip"], line["mergeBase"]
        # 1. objects exist
        for sha, label in ((tip, "tip"), (mb, "mergeBase")):
            r = subprocess.run(["git", "cat-file", "-e", sha], capture_output=True)
            if r.returncode != 0:
                failures.append(f"{name}: {label} {sha} missing")
        if failures:
            continue
        # 2. merge-base matches
        live_mb = git("merge-base", tip, mb).strip()
        if live_mb != mb:
            failures.append(f"{name}: live merge-base {live_mb} != {mb}")
        # 3. ahead/behind vs baseline
        ahead = int(git("rev-list", "--count", f"{baseline}..{tip}").strip())
        behind = int(git("rev-list", "--count", f"{tip}..{baseline}").strip())
        if ahead != line["aheadOfBase"] or behind != line["behindBase"]:
            failures.append(
                f"{name}: ahead/behind live {ahead}/{behind} != matrix "
                f"{line['aheadOfBase']}/{line['behindBase']}"
            )
        # 4. changed files (name-status) match
        live_files = sorted(
            git("diff", "--name-status", f"{mb}..{tip}").strip().splitlines()
        )
        if live_files != sorted(line["changedFiles"]):
            only_live = [x for x in live_files if x not in line["changedFiles"]]
            only_matrix = [x for x in line["changedFiles"] if x not in live_files]
            failures.append(
                f"{name}: changedFiles mismatch; only_live={only_live[:5]} "
                f"only_matrix={only_matrix[:5]}"
            )
        # 5. commit list (sha|subject, oldest-first) matches
        live_commits = list(
            reversed(git("log", "--format=%H|%s", f"{mb}..{tip}").strip().splitlines())
        )
        if live_commits != line["commits"]:
            failures.append(
                f"{name}: commits mismatch live={len(live_commits)} "
                f"matrix={len(line['commits'])}"
            )

    if failures:
        for f in failures:
            print(f"FAIL {f}")
        return 1
    print(
        f"OK: {len(matrix['lines'])} lines validated against live Git "
        f"(baseline {baseline[:7]}); tips, merge-bases, ahead/behind, "
        f"files, and commits all match."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
