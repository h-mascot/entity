# T-030 XLSX semantic fixture

`full-fidelity.json` is the sanitized, deterministic source fixture for the local XLSX gate.
The test builds it into a real SpreadsheetML XLSX ZIP package (via `createXlsxPackage`) and
reopens that package through the same bounded validator used by create, open, human save,
agent range mutation, and reopen.

Covered semantics: multiple named sheets, inline string values, a representative subset of
formatting-shaped values, XML/entity escaping, Unicode, and a formula-shaped cell that the
engine deliberately treats as plain text. Formula recalculation is **not** claimed or
performed; the engine documents rather than assumes recalculation behavior (PRD 16.5).

Images, charts, pivot tables, external links, macros, embedded objects, and full number/date
fidelity are deliberately absent because T-030 does not claim perfect Excel fidelity
(non-goal).

External Office/editor proof is not encoded here. T-025 selected only a reversible desktop
bridge boundary and deferred a concrete editor. The automated gate therefore proves local
SpreadsheetML semantics and range mutation, not Microsoft Excel, LibreOffice, browser, or
Electron rendering fidelity.
