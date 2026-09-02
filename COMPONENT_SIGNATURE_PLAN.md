# CLPROMPTER Component Signature Plan

## Status
- Decision: Defer implementation for now.
- Reason: Current IBM guidance for external SQL routine signature verification is incomplete for our mixed-version IBM i estate and shared-library workflows.
- Next checkpoint: Sept 9 meeting.

## Current Behavior (As-Is)
- CLPROMPTER components register with Code for IBM i using getIdentification/getRemoteState/update.
- Version is the effective update trigger for CMD_HELP, CMD_XML, and CMD_RUN.
- Local signature exists in code, but remote signature is not currently derived from host metadata in a way that enforces meaningful tamper checks for external programs.

## Constraints and Design Gaps to Discuss
- Shared install library model (often mislabeled as temp library) means multiple developers can point to the same host library.
- A new developer can connect to an already-populated shared library without having performed the original install.
- External SQL routine signature helper paths generally resolve identity metadata (for example EXTERNAL_NAME), not object-content hash.
- Identity-only signatures do not detect program object content change when name remains constant.
- V7R3 and earlier compatibility may block use of preferred host hashing approaches.

## Target Outcome (Future State)
- Achieve compliance with Code for IBM i component-signature lifecycle.
- Return host-derived remoteSignature in getRemoteState/update.
- Support shared-library bootstrap safely (new client with pre-existing routines).
- Avoid false mismatch loops from library volatility.

## Proposed Signature Strategy (External SQL Functions)
- Signature basis for each function:
  - Canonical string from host metadata (minimum: EXTERNAL_NAME).
  - Optionally append component version token if policy requires release-bound signatures.
- Canonicalization rules (must be identical locally and remotely):
  - TRIM
  - UPPERCASE
  - Stable delimiter between parts if concatenating fields
- Hash algorithm:
  - SHA-256 over canonical string.

## Bootstrap and Shared-Library Rules
- On first connect for a client profile:
  - If routine exists and remote signature equals local expected signature: Installed.
  - If routine exists and signature differs: NeedsUpdate (not Installed).
  - If routine missing: NotInstalled/NeedsUpdate.
- After update:
  - Re-read host metadata.
  - Recompute remote signature.
  - Return Installed with remoteSignature.

## Runtime Verification Flow
- getIdentification:
  - Returns deterministic local signature for the component build.
- getRemoteState:
  - Queries host routine metadata.
  - Computes current remote signature from host metadata.
  - Returns status + remoteSignature.
- update:
  - Uploads/compiles/deploys.
  - Re-queries host metadata.
  - Returns Installed + remoteSignature from freshly deployed host state.

## Implementation Plan (Deferred)
1. Introduce signature utility functions in hostFunctions layer.
2. Add SQL query helper for routine metadata retrieval (schema, routine name, specific name, external_name).
3. Implement canonicalization and SHA-256 function for signature payload.
4. Update each checker (CMD_HELP, CMD_XML, CMD_RUN):
   - getRemoteState computes host-derived remoteSignature.
   - update returns post-deploy remoteSignature.
5. Preserve version gating as fallback where signature derivation unavailable.
6. Add guarded behavior for legacy host levels (for example V7R3 compatibility).
7. Add logging markers for diagnosis:
   - local signature
   - remote signature
   - status decision path
8. Add tests:
   - same signature -> Installed
   - mismatch -> NeedsUpdate
   - shared library pre-existing object -> bootstrap behavior
   - post-update state convergence

## Meeting Agenda Inputs (Sept 9)
- Clarify IBM requirement for external SQL routine signatures:
  - Is metadata-identity hashing acceptable?
  - Is object-content verification required?
- Clarify expected behavior for shared install libraries:
  - How should first-time clients trust/refresh pre-existing components?
- Clarify minimum IBM i version matrix for approved hashing path.
- Confirm acceptable user-facing behavior on mismatch:
  - automatic update vs explicit prompt vs hard block

## Decision Log Template (for post-meeting update)
- Requirement source:
- Accepted signature input fields:
- Accepted canonicalization rules:
- Required host versions:
- Shared-library policy:
- Mismatch policy:
- Implementation start date:

## Notes
- Keep this plan as a living document.
- When implementation begins, add task-by-task progress and links to changed files and tests.
