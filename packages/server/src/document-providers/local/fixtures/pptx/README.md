# T-031 PPTX semantic fixture

`full-fidelity.json` is the sanitized, deterministic source fixture for the local PPTX gate.
The test builds it into a real Office Open XML (PresentationML) PPTX ZIP package via
`createPptxPackage` and reopens that package through the same bounded validator used by
create, open, human save, agent slide mutation, and reopen.

Covered semantics: multiple slides with stable ids, ordered title/body/subtitle/notes text
elements, XML/entity escaping, and Unicode. Representing a presentation, slide ordering is
preserved on round trip.

Images, charts, transitions, embedded media, macros, external links, slide layouts with
placeholders beyond text, and full rendering fidelity are deliberately absent because T-031
does not claim perfect PowerPoint fidelity or image mutation (non-goal; PRD 16.6 lists
"images where supported" — this gate documents rather than claims them).

The bounded agent lane is `presentation.slide.update` (§12.5 / R-023): an authorized
`update_slide_text` targeting one stable slide/element id, encoded in the canonical `slide`
AdapterMutation lane as the JSON `{"slideRef","elementRef","text"}` envelope inside `slideId`
(same convention as the Google slides adapter). The engine fails closed for any malformed,
unknown, or out-of-bounds targeting.

External Office/editor proof is not encoded here. T-025 selected only a reversible desktop
bridge boundary and deferred a concrete editor. The automated gate therefore proves local
PresentationML semantics and slide text mutation, not Microsoft PowerPoint, LibreOffice,
browser, or Electron rendering fidelity.
