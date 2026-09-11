"""Colocated regression tests for validate_matrix.py.

Run: python3 -m unittest discover -s docs/recovery/deploy-reconciliation-20260824 \
        -p "validate_matrix_test.py" -v

Covers the merge-base hardening: the stored `mergeBase` must be the line's
true fork point versus the *baseline* (git merge-base tip baseline), not merely
some ancestor of the tip. A wrong older ancestor used to validate cleanly
because changed-file and commit lists are re-derived from the same wrong
merge-base, so only the baseline comparison can catch it.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "validate_matrix.py"


class RepoFixture:
    """Tiny git repo: main R0->R1->R2 (baseline), line forks at R2: L1->L2."""

    def __init__(self, root: Path):
        self.root = root
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "recovery@example.invalid")
        self.git("config", "user.name", "recovery-test")
        self.commit("base.txt", "R0 root")
        self.r1 = self.commit("r1.txt", "R1 on main")
        self.r2 = self.commit("r2.txt", "R2 on main (baseline)")
        self.git("checkout", "-q", "-b", "line")
        self.l1 = self.commit("l1.txt", "L1 on line")
        self.l2 = self.commit("l2.txt", "L2 on line tip")
        self.baseline = self.r2
        self.tip = self.l2

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, check=True, cwd=self.root
        ).stdout

    def commit(self, filename: str, subject: str) -> str:
        (self.root / filename).write_text(f"{subject}\n", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", subject)
        return self.git("rev-parse", "HEAD").strip()

    def changed_files(self, mb: str, tip: str) -> list:
        return sorted(self.git("diff", "--name-status", f"{mb}..{tip}").strip().splitlines())

    def commits(self, mb: str, tip: str) -> list:
        return list(reversed(self.git("log", "--format=%H|%s", f"{mb}..{tip}").strip().splitlines()))

    def line_entry(self, merge_base: str, derive_from: str) -> dict:
        ahead = int(self.git("rev-list", "--count", f"{self.baseline}..{self.tip}").strip())
        behind = int(self.git("rev-list", "--count", f"{self.tip}..{self.baseline}").strip())
        return {
            "tip": self.tip,
            "mergeBase": merge_base,
            "aheadOfBase": ahead,
            "behindBase": behind,
            "changedFiles": self.changed_files(derive_from, self.tip),
            "commits": self.commits(derive_from, self.tip),
        }

    def write_matrix(self, path: Path, line: dict) -> None:
        path.write_text(
            json.dumps(
                {"baseline": {"sha": self.baseline, "branch": "main"}, "lines": {"test-line": line}},
                indent=2,
            ),
            encoding="utf-8",
        )


class ValidateMatrixTest(unittest.TestCase):
    def run_validator(self, cwd: Path, matrix: Path) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["GIT_AUTHOR_NAME"] = env["GIT_AUTHOR_EMAIL"] = "recovery-test"
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(matrix)],
            capture_output=True,
            text=True,
            cwd=cwd,
            env=env,
        )

    def test_true_fork_point_validates(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = RepoFixture(Path(tmp))
            matrix = Path(tmp) / "matrix.json"
            repo.write_matrix(matrix, repo.line_entry(repo.r2, repo.r2))
            result = self.run_validator(Path(tmp), matrix)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("OK", result.stdout)

    def test_wrong_older_merge_base_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = RepoFixture(Path(tmp))
            matrix = Path(tmp) / "matrix.json"
            # mergeBase R1 is an older ancestor: every list is derived
            # consistently from R1..tip, so file/commit checks pass, but the
            # true fork point versus the baseline is R2. Only the baseline
            # merge-base comparison can catch this.
            repo.write_matrix(matrix, repo.line_entry(repo.r1, repo.r1))
            result = self.run_validator(Path(tmp), matrix)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("merge-base", result.stdout)

    def test_newer_non_ancestor_merge_base_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = RepoFixture(Path(tmp))
            matrix = Path(tmp) / "matrix.json"
            # mergeBase = L1 is on the line itself, past the fork point: git
            # merge-base tip L1 == L1 passes the old ancestry-only check while
            # the ranges silently drop the fork-point commit.
            repo.write_matrix(matrix, repo.line_entry(repo.l1, repo.l1))
            result = self.run_validator(Path(tmp), matrix)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_unrelated_history_reports_failure_without_crashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = RepoFixture(Path(tmp))
            # Orphan branch with no common history with the baseline.
            repo.git("checkout", "-q", "--orphan", "unrelated")
            repo.git("rm", "-rqf", ".")
            orphan_tip = repo.commit("orphan.txt", "orphan commit")
            matrix = Path(tmp) / "matrix.json"
            entry = repo.line_entry(repo.r2, repo.r2)
            entry["tip"] = orphan_tip
            repo.write_matrix(matrix, entry)
            result = self.run_validator(Path(tmp), matrix)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
