# SNOWCRAFT hand-off archive (version 0.14.0)

Paste HANDOFF-PROMPT.md into the publishing thread first. Then open in this order: 1) playgama/status-0.14.0.md (what is done, what blocks) 2) HANDOFF.md (the whole picture) 3) playgama/risks.md and compliance-matrix.md.

Inside:
- release/snowcraft-playgama-v0.14.0.zip: the Playgama archive (index.html, Bridge 2.4.1, config). release/snowcraft-preview-v0.14.0.html: single-file preview that runs anywhere.
- verify/snowcraft-v0.14.0.json: build passport (hand-written, verify-build not available in the build chat).
- playgama/: store texts in 10 languages, cover brief, 8 screenshots, QA checklist, compliance matrix, risks, owner decisions, Bridge config.
- design/, playtest/, DESIGN.md, SPEC.md: design documents, audits, the «from scratch» plan, playtest reports and the fix list.
- source/: the full source tree (npm install; npm run build; npm run build:pg for the Playgama archive; tests: see HANDOFF.md).

Hard facts: the SANDBOX IS PUBLISHED (https://playgama.ai/play/q4wus3iavhanwx, game id cmwajeosz1jkfog0hdkosflqm, archive id cmwam8ifv1oc8og0hc426xycr, build check PASSED, placeholder covers uploaded). Not submitted to moderation, not in the catalog; blockers for those: code-synthesized sound, AI-art risk, QA-tool certification, verify-build not run. Top backlog: (1) real audio, (2) «from scratch» redesign (design/from-scratch.md), (3) wire cell fire (design/noita-audit.md).
