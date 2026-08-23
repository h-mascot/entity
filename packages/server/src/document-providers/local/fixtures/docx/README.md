# T-029 DOCX semantic fixture

`full-fidelity.json` is the sanitized, deterministic source fixture for the local DOCX gate.
The test builds it into a real OOXML ZIP package and reopens that package through the same
bounded validator used by create, open, human save, agent mutation, and reopen.

Covered semantics: paragraphs, Heading 1, ordered document blocks, bullet-list items, a
two-row table, bold/italic run styling, XML escaping, and Unicode. Images are deliberately
absent because T-029 does not claim image mutation or external-editor image fidelity.

Source/license: generated for Entity T-029; no customer or personal content; repository license.

External Office/editor proof is not encoded here. T-025 selected only a reversible desktop-
bridge boundary and deferred a concrete editor, transport, platform matrix, and licensing
decision. The automated gate therefore proves local OOXML semantics, not Microsoft Word,
LibreOffice, browser, or Electron rendering fidelity.
