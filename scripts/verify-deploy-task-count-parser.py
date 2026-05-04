#!/usr/bin/env python3
"""Focused regression check for deploy.sh post-deploy task count parsing."""
import json


def task_count(raw: str) -> int:
    raw = raw.strip()
    if not raw:
        return 0
    payload = json.loads(raw)
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict):
        total = payload.get("total")
        if isinstance(total, int):
            return total
        tasks = payload.get("tasks")
        if isinstance(tasks, list):
            return len(tasks)
        raise ValueError("tasks response did not contain an array or numeric total")
    raise ValueError("tasks response was not a list or object")


def main() -> None:
    cases = [
        ([], 0),
        ([{"id": 1}, {"id": 2}], 2),
        ({"tasks": [{"id": 1}], "count": 1}, 1),
        ({"tasks": [0] * 500, "count": 500, "limit": 500, "offset": 0, "total": 520, "hasMore": True}, 520),
    ]
    for payload, expected in cases:
        actual = task_count(json.dumps(payload))
        print(f"{type(payload).__name__}: {actual}")
        assert actual == expected, (payload, actual, expected)
    print("deploy task count parser regression passed")


if __name__ == "__main__":
    main()
