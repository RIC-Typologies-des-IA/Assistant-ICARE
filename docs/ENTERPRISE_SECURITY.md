# Enterprise security posture

> Status: architecture and implementation requirements. This document describes the intended security properties and the evidence required to claim them; it is not a certification or a statement that every control is already implemented.

## 1. Security objective

ICARE is designed as a local-first Progressive Web Application (PWA). Project data, conversation history, working state and local artefacts should remain in the user's browser profile or in files explicitly selected by the user. A remote inference service may be called when the user invokes an AI capability.

The objective is to preserve this model while making its security properties demonstrable to enterprise IT and security teams.

**Do not claim that “nothing leaves the browser” until network traffic has been inventoried and tested.** Application hosting, PWA updates, fonts, telemetry, error reporting, authentication, model discovery, voice services and inference may all create network requests. The approved egress policy must describe every one of them.

## 2. Trust boundaries and data flows

### 2.1 Local browser boundary

The browser is the primary execution and persistence environment:

- UI, application logic and WebAssembly modules execute client-side.
- Project persistence uses browser storage such as IndexedDB where appropriate.
- Import/export uses user-initiated browser file pickers and downloads.
- The application must not require a backend to store projects or conversation history.

Browser-local does not mean inherently protected. Same-origin JavaScript can access origin storage, so an XSS or compromised dependency can expose locally stored projects. A compromised workstation or browser profile is also in scope.

### 2.2 Remote boundary

Remote calls must be explicit, documented and allowlisted. The expected business-data egress is inference: the user-selected prompt/context and any attachments intentionally included in that request.

Any other egress (hosting and updates, authentication, telemetry, crash reporting, model catalogues, speech-to-text, analytics, external assets) must be separately identified, justified, configurable and disclosed. No analytics or third-party tracking should be enabled by default.

### 2.3 Inference gateway

Support a configurable inference endpoint so an organization can route requests through its own gateway or approved provider. The gateway is an inference transport/policy boundary, not a project-storage backend.

The gateway should support:
- Explicit endpoint configuration and TLS.
- Organization-managed authentication without embedding long-lived secrets in the frontend bundle.
- Destination allowlisting and provider/model restrictions.
- Request size and rate limits.
- Minimal operational logging; prompt and response bodies must not be logged by default.
- Clear data-retention and provider-processing documentation.

A browser-only client cannot safely hold a shared provider API secret. Where credentials are required, use short-lived, scoped credentials issued by an enterprise gateway or an appropriate user-authenticated flow.

## 3. Local data protection

- Keep project data local by default; do not silently synchronize or upload it.
- Use IndexedDB for structured local persistence, with schema versioning and safe migrations.
- Never store passwords, provider API keys, refresh tokens or other long-lived credentials in IndexedDB, localStorage, Cache Storage or the application bundle.
- In the browser client, provider keys are held in sessionStorage for the current tab session only; they are not persisted in IndexedDB. sessionStorage remains readable by same-origin JavaScript and is not an XSS defense. Enterprise deployments should prefer short-lived credentials issued by a gateway.
- Treat browser storage as accessible to scripts executing in the same origin.
- Offer optional project encryption for deployments handling confidential data. Use authenticated encryption and a standard Web Crypto API primitive; never invent a cryptographic algorithm.
- Derive or obtain encryption keys using an explicit user/enterprise-controlled key lifecycle. Do not hard-code keys or store the decryption key beside ciphertext.
- Document recovery implications: losing the key may make an encrypted project unrecoverable.
- Ensure export/import preserves integrity and handles malformed or oversized files safely.
- Provide a clear local-data deletion/export path and explain browser-profile/OS backup implications.

Encryption at rest in the browser is defense in depth, not protection against malicious same-origin code or a compromised, unlocked user session.

## 4. Browser and PWA compatibility

The core application must remain usable with conservative enterprise browser policies.

- Serve the PWA over HTTPS (or localhost in development).
- Treat service-worker installation and offline caching as progressive enhancements, not prerequisites for opening/importing/exporting a project.
- Provide a standard file input + download fallback; do not make the File System Access API mandatory.
- Request optional permissions only when the user invokes the corresponding feature.
- Do not require browser extensions, native host applications, broad filesystem permissions or administrator privileges.
- Document the minimum supported versions of Edge, Chrome and Firefox after testing.
- Document behavior when service workers, persistent storage, third-party cookies, pop-ups, downloads or filesystem permissions are restricted.
- Ensure application updates do not silently destroy or migrate user data incompatibly.

## 5. Web application security controls

- Deploy from an organization-controlled origin where possible.
- Enforce a restrictive Content Security Policy. Prefer nonce/hash-based script policies and avoid `unsafe-eval`; document any unavoidable exception.
- Use Trusted Types where supported and applicable.
- Prevent XSS: contextual output encoding, safe Markdown rendering, URL/scheme validation, and no unsafe HTML injection.
- Pin and audit dependencies; generate an SBOM and scan dependencies in CI.
- Do not load executable code from third-party CDNs at runtime. Bundle and review runtime dependencies.
- Apply Subresource Integrity to any unavoidable externally hosted static resource.
- Set appropriate security headers, including HSTS, frame restrictions, MIME sniffing protection and a restrictive Referrer-Policy.
- Keep secrets out of source code, build artefacts, source maps and client-visible configuration.
- Validate imported project files as untrusted input; enforce size limits and schema validation.
- Treat model output, Markdown, links, tool instructions and imported content as untrusted data.

## 6. Network egress policy and auditability

Maintain a machine-readable inventory of all outbound destinations, including purpose, data category, trigger, environment and whether the destination is mandatory or optional.

Default policy:
- No analytics, advertising, tracking pixels or third-party telemetry.
- No project synchronization or remote project backup.
- No remote logging of prompts, responses, imported documents or project contents.
- No dynamic executable code loading from unapproved origins.
- Only approved inference and explicitly documented operational endpoints may be contacted.

Add automated tests that fail when an unapproved origin is contacted. Include browser-level tests that capture requests during startup, project creation, editing, import/export, offline use, model selection, inference, errors and updates.

A “zero business-data egress except inference” claim is acceptable only when the tests and deployment configuration substantiate it. Static asset delivery and application updates are network traffic even if they do not contain project data.

## 7. Threat model

| Threat | Main mitigation | Residual limitation |
| --- | --- | --- |
| XSS / malicious Markdown or model output | CSP, safe renderer, sanitization, Trusted Types, tests | Same-origin compromise can read local storage |
| Compromised dependency or supply chain | Lockfiles, dependency review, SBOM, CI scanning, controlled builds | Maintainer/build pipeline compromise remains possible |
| Unapproved data egress | Egress inventory, allowlist, network tests, no default telemetry | Browser policy and deployment must enforce the intended routes |
| Local profile or workstation compromise | OS controls, optional project encryption, session hygiene | Unlocked compromised endpoint can access plaintext |
| Malicious/invalid project file | Strict schema validation, size limits, safe parsing | Parser vulnerabilities remain possible |
| Inference provider retention or training | Approved provider/gateway, contractual controls, minimal context | Depends on provider and enterprise configuration |
| Stale or tampered application code | Controlled origin, release integrity, version pinning, review | Browser still trusts delivered application code |
| Browser policy blocks PWA feature | Progressive enhancement and file-input fallback | Some managed environments may disable all local persistence |

## 8. Enterprise deployment profiles

### Profile A — Standard managed browser

- PWA served from a trusted HTTPS origin.
- Local IndexedDB persistence.
- User-initiated import/export.
- Inference to an approved provider.
- No optional telemetry by default.

### Profile B — Enterprise-controlled

- Application hosted on an internal or explicitly approved origin.
- Pinned application release and reviewed dependencies.
- Strict CSP and security headers.
- Enterprise SSO where required.
- Inference routed through an organization-managed gateway.
- Optional local project encryption and documented key management.
- Administrators can inspect the network destination inventory.

### Profile C — Sovereign / isolated

- Application assets hosted internally.
- Inference served by an internal or contractually approved sovereign service.
- No public third-party runtime dependencies.
- Offline-capable local workflows.
- Egress denied by default at the network layer, with only explicitly approved destinations opened.

These profiles are deployment options, not claims of certification or regulatory compliance.

## 9. Implementation plan

1. **Baseline and inventory**
   - Map all runtime network requests and browser permissions.
   - Identify every persistence location and data category.
   - Document current browser support and service-worker behavior.
2. **Security headers and supply chain**
   - Add/test CSP and related headers at the hosting layer.
   - Audit dependencies, produce an SBOM and define release provenance.
3. **Network isolation**
   - Centralize outbound requests behind a small transport layer.
   - Add an explicit endpoint allowlist and disable nonessential telemetry.
   - Add browser tests that assert the allowed request set.
4. **Local data protection**
   - Review IndexedDB schema, migrations, deletion and export.
   - Remove any credentials from persistent browser storage.
   - Specify and implement optional project encryption with a reviewed key lifecycle.
5. **Enterprise compatibility**
   - Test managed Edge, Chrome and Firefox profiles.
   - Verify operation with File System Access API unavailable.
   - Verify service-worker restrictions and offline degradation.
6. **Security evidence**
   - Publish the data-flow diagram, destination inventory, permissions matrix, SBOM and test results.
   - Run dependency, static analysis and browser security tests in CI.
   - Document residual risks and operational responsibilities.

## 10. Acceptance criteria

- [ ] A complete inventory documents every outbound request, its destination, purpose and data category.
- [ ] Automated browser tests verify that no unapproved destination is contacted during core workflows.
- [ ] No project content is sent remotely except content explicitly included in a user-triggered inference request.
- [ ] No analytics or third-party tracking runs by default.
- [ ] No long-lived API key or authentication secret is embedded in frontend code or persisted in browser storage.
- [ ] Project creation, editing, reopening, import and export work without a project-storage backend.
- [ ] Import/export works without the File System Access API.
- [ ] Core local workflows degrade safely when service workers are unavailable.
- [ ] CSP and security headers are tested against the production build.
- [ ] Markdown/model output and imported files are treated as untrusted input.
- [ ] Dependency inventory/SBOM and vulnerability checks are part of CI.
- [ ] Browser compatibility is tested and documented for managed Edge, Chrome and Firefox.
- [ ] Optional encryption has documented key management, recovery limitations and tests before being advertised as available.
- [ ] Security documentation clearly distinguishes implemented controls from planned controls and residual risks.

## 11. Security positioning

Recommended wording:

> ICARE is a local-first browser application. Projects and conversation history are stored locally and are not synchronized to an ICARE project server. When AI inference is requested, the selected context is sent to the configured inference endpoint. Other network destinations and browser permissions are documented and controlled by the deployment configuration.

Avoid absolute claims such as “there is no security risk” or “nothing ever leaves the browser.” Enterprise acceptance depends on the actual build, hosting configuration, browser policies, inference provider contract and endpoint security.
