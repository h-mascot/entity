// Geordi QA compact evidence index verification (GQR-006).
//
// The compact evidence index must stay lightweight and base64-free, and its
// payload checks must be SEMANTIC: each evidence metadata record is matched
// against its index entry by structural field equality (path, lane). The old
// approach — substring checks against serialized metadata — accepts prefix
// paths ("A/x.jpeg" matching "A/x.jpeg-backup") and note text that merely
// mentions another entry's path. Those false positives are exactly what this
// verifier rejects.

const ENTRY_SECTIONS = ["screenshots", "axCaptures"];
// The receipts section is named `actions` in the historical compact indexes;
// `actionReceipts` is accepted as an explicit alias.
const RECEIPTS_SECTION_ALIASES = ["actionReceipts", "actions"];

const BASE64_DATA_URI = /^data:[^;,]*;base64,/i;
const LONG_BASE64_RUN = /[A-Za-z0-9+/]{300,}={0,2}/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scanBase64(value, trail, violations) {
  if (typeof value === "string") {
    if (BASE64_DATA_URI.test(value) || LONG_BASE64_RUN.test(value)) {
      violations.push({ type: "base64-payload", at: trail });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => scanBase64(entry, `${trail}[${i}]`, violations));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      scanBase64(entry, `${trail}.${key}`, violations);
    }
  }
}

export function verifyCompactIndex(index, evidenceMetadata, { allowedLanes } = {}) {
  if (!isPlainObject(index)) throw new Error("index must be an object");
  if (index.schemaVersion !== 1) throw new Error("index schemaVersion must be 1");
  if (typeof index.runId !== "string" || index.runId.length === 0) {
    throw new Error("index runId must be a non-empty string");
  }
  for (const section of [...ENTRY_SECTIONS, ...RECEIPTS_SECTION_ALIASES]) {
    if (index[section] !== undefined && !Array.isArray(index[section])) {
      throw new Error(`index ${section} must be an array`);
    }
  }
  if (!RECEIPTS_SECTION_ALIASES.some((alias) => Array.isArray(index[alias]))) {
    throw new Error(`index must carry a receipts array (${RECEIPTS_SECTION_ALIASES.join(" or ")})`);
  }
  if (!Array.isArray(evidenceMetadata)) {
    throw new Error("evidenceMetadata must be an array");
  }

  const violations = [];
  scanBase64(index, "index", violations);

  // Flatten index entries with their section, then build a semantic map keyed
  // by the metadata path so matching is structural, never textual-substring.
  const indexedByPath = new Map();
  const sections = [
    ...ENTRY_SECTIONS,
    ...RECEIPTS_SECTION_ALIASES.filter((alias) => Array.isArray(index[alias])),
  ];
  for (const section of sections) {
    index[section].forEach((entry, position) => {
      if (!isPlainObject(entry) || typeof entry.path !== "string") {
        violations.push({ type: "malformed-entry", section, position });
        return;
      }
      if (indexedByPath.has(entry.path)) {
        violations.push({ type: "duplicate-entry", path: entry.path });
        return;
      }
      indexedByPath.set(entry.path, { entry, section });
      if (Array.isArray(allowedLanes) && !allowedLanes.includes(entry.lane)) {
        violations.push({ type: "unknown-lane", path: entry.path, lane: entry.lane });
      }
    });
  }

  for (const metadata of evidenceMetadata) {
    if (!isPlainObject(metadata) || typeof metadata.path !== "string") {
      violations.push({ type: "malformed-metadata", metadata });
      continue;
    }
    const match = indexedByPath.get(metadata.path);
    if (!match) {
      // Diagnose the substring trap explicitly: an indexed path that merely
      // shares a prefix with the metadata path is a mismatch, never a match.
      const nearMiss = [...indexedByPath.keys()].find(
        (candidate) =>
          candidate.startsWith(`${metadata.path}-`) ||
          `${candidate}-`.startsWith(`${metadata.path}-`) ||
          metadata.path.startsWith(`${candidate}/`) ||
          candidate.startsWith(`${metadata.path}/`),
      );
      if (nearMiss) {
        violations.push({
          type: "field-mismatch",
          field: "path",
          metadataPath: metadata.path,
          indexedPath: nearMiss,
          note: "paths share a prefix; substring matching would falsely accept",
        });
      } else {
        violations.push({ type: "missing-from-index", metadataPath: metadata.path });
      }
      continue;
    }
    // Semantic payload equality: fields must agree exactly. A shared substring
    // between serialized values is never acceptance evidence.
    if (match.entry.path !== metadata.path) {
      violations.push({
        type: "field-mismatch",
        field: "path",
        metadataPath: metadata.path,
        indexedPath: match.entry.path,
      });
    }
    if (metadata.lane !== undefined && match.entry.lane !== metadata.lane) {
      violations.push({
        type: "field-mismatch",
        field: "lane",
        metadataPath: metadata.path,
        indexedLane: match.entry.lane,
        metadataLane: metadata.lane,
      });
    }
    match.matched = true;
  }

  let unindexedEntries = 0;
  for (const { matched } of indexedByPath.values()) {
    if (!matched) unindexedEntries += 1;
  }

  return {
    ok: violations.length === 0,
    checkedEntries: evidenceMetadata.length,
    unindexedEntries,
    violations,
    summary: {
      runId: index.runId,
      sections: Object.fromEntries(sections.map((s) => [s, index[s].length])),
    },
  };
}
