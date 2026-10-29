# qTest analysis and IbuTest feature parity

This document summarises how Tricentis qTest works, what IbuTest implements today, and what
remains on the roadmap. "qTest" is a trademark of Tricentis; IbuTest is an independent product.

## 1. What qTest is

qTest is Tricentis' unified test management platform, sold as SaaS or on-premise and aimed
at QA analysts, test engineers and automation teams that need centralised test case
management, defect tracking and release validation. A public listing quotes pricing from
about USD 1,000 per user per year.

It is made of several modules:

| Module | Purpose |
|---|---|
| **qTest Manager** | Core test management: requirements, test design, test execution, defects |
| **qTest Insights** | Real-time metrics, dashboards and cross-project reports |
| **qTest Launch** | Orchestrates open-source / automation frameworks and collects their results |
| **qTest Explorer** | Records exploratory testing sessions (screens, actions) into documentation |
| **qTest Scenario** | BDD scenario development (Gherkin) alongside Jira |
| **qTest Pulse** | Workflow automation / rules between qTest, CI and Agile tools |
| **qTest Copilot** | Generative AI that drafts test cases (steps + expected results) from requirements |

Jira integration (linking requirements, test cases, executions and bugs) is central to how
most teams use it.

### Core object model (qTest Manager)

```
Project
├── Requirements (organised in modules/folders) ──┐ traceability
├── Test Design: modules → test cases → steps  ◄──┘   (versioned, approval workflow)
├── Test Execution: release → cycle → suite → test run → test logs
└── Defects (native or Jira), linked to test runs
Insights: reports & dashboards over all of the above
```

### qTest Copilot (AI)

Launched in November 2024. From a requirement, the user chooses *Generate with AI*; Copilot
reads the requirement's criteria and drafts test cases with steps and expected results, which
the user reviews, edits and then approves or rejects. Admins can enable or disable AI features
per project through an "AI hub". Tricentis claims savings of up to 20 minutes per test case
(vendor claim, not independently measured).

### Observed pain points (public reviews)

- Cost per seat is high for small teams.
- Insights queries become slow when many projects are selected.
- Breadth of modules means configuration and administration overhead.

## 2. IbuTest scope and parity

Legend: ✅ implemented · ◐ partial · ⏳ roadmap · ? not verified from public sources

| Capability | qTest | IbuTest | Notes |
|---|---|---|---|
| Projects, membership, roles | ✅ | ✅ | Global admin/user + per-project viewer / tester / lead / manager |
| Requirements in folders (modules) | ✅ | ✅ | Nested folders, priority, type, status, external reference |
| Requirement ↔ test case traceability | ✅ | ✅ | Many-to-many links, coverage KPI, traceability matrix with latest result |
| Test cases with steps & expected results | ✅ | ✅ | Steps with test data, preconditions, tags, estimate, automation key |
| Test case versioning | ✅ | ✅ | Every content change snapshots a new version; history viewer |
| Approval workflow | ✅ | ✅ | Leads approve; editing an approved case resets it to "ready" |
| Clone test case | ✅ | ✅ | |
| Shared steps / parameters | ? | ⏳ | Planned: called test cases and data-driven parameters |
| Custom fields | ? | ⏳ | Planned per-project field definitions |
| Releases → cycles → runs | ✅ | ✅ | Suites are represented by folders added to a cycle (◐ no separate suite object) |
| Step-by-step manual execution | ✅ | ✅ | Per-step pass/fail/block/skip + actual result, overall status suggestion, timer |
| Execution history (test logs) | ✅ | ✅ | Immutable log per execution with step snapshots |
| Run assignment | ✅ | ✅ | |
| Defects linked to runs | ✅ | ✅ | Pre-filled from the failed run; severity/priority/status workflow |
| Attachments / evidence | ✅ | ✅ | Content-sniffed uploads (images, PDF, logs, video, zip), 10 MB limit |
| Dashboards & reports (Insights) | ✅ | ◐ | Project dashboard, trend, cycle report, traceability; no custom report builder yet |
| CSV / Excel export | ✅ | ✅ | CSV with formula-injection protection |
| CSV / Excel import | ? | ⏳ | Planned with strict schema validation |
| Automation results (Launch / API) | ✅ | ✅ | Project API tokens, JSON results API, auto-creates automated test cases |
| JUnit XML upload | ? | ⏳ | Planned using an XXE-safe parser |
| Jira integration | ✅ | ◐ | External reference fields today; two-way sync planned (allow-listed outbound only) |
| BDD / Gherkin scenarios | ✅ (Scenario) | ⏳ | |
| Exploratory session recording | ✅ (Explorer) | ⏳ | |
| Workflow rules (Pulse) | ✅ | ⏳ | Planned as signed outbound webhooks |
| AI test case generation | ✅ (Copilot) | ✅ | From a requirement or free text; drafts reviewed before saving |
| AI test case review | ? | ✅ | Quality score, issues per step, extra coverage ideas |
| AI defect drafting | ? | ✅ | From a failed run's step results and comments |
| AI release readiness summary | ? | ✅ | Per cycle: readiness, risks, recommendations |
| AI controls | ✅ (AI hub) | ✅ | Server-wide on/off (API key), per-project toggle, per-user rate limit and daily token quota |
| Audit trail | ? | ✅ | Security and data events with actor, IP, user agent |
| SSO (SAML / OIDC) | ? | ⏳ | Local accounts + TOTP 2FA today |
| Two-factor authentication | ? | ✅ | Built-in TOTP, optional "admins must use 2FA" policy |
| Deployment | SaaS / on-prem | ✅ | Docker (PostgreSQL), single binary desktop, mobile apps |
| Desktop app | ? | ✅ | Windows/macOS/Linux; team-server or offline local workspace |
| Mobile apps | ? | ✅ | iOS / Android (Capacitor) + installable PWA |

## 3. How IbuTest's AI differs

- **Human in the loop by design** - generated test cases, reviews and defect drafts are never
  saved automatically; a tester accepts, edits or discards them.
- **Prompt-injection resistant** - requirement and test text is passed as delimited data with an
  instruction to never follow embedded instructions; the model has no tools, so injected text
  cannot trigger actions; output is constrained to a JSON schema, validated and length-capped,
  and rendered as plain text.
- **Cost and abuse controls** - per-user hourly rate limit and daily token quota, per-project
  disable switch, usage recorded per feature for chargeback.
- **Key never leaves the server** - desktop and mobile clients call the IbuTest API, never the
  AI provider directly.
- Model: Claude (`claude-opus-5-5` by default, configurable with `AI_MODEL` / `AI_EFFORT`).

## 4. Roadmap (suggested order)

1. SSO (OIDC first, then SAML) with SCIM user provisioning.
2. Jira two-way sync (allow-listed hosts, encrypted credentials, signed webhooks).
3. Shared steps and test parameters; custom fields.
4. JUnit XML and CSV/Excel import.
5. Report builder and cross-project dashboards (with query limits to avoid the slowness
   reviewers report for qTest Insights).
6. Outbound webhooks / workflow rules; e-mail notifications and self-service password reset.
7. Horizontal scaling: Redis-backed rate limiting and S3-compatible attachment storage.

## Sources

- [Tricentis qTest features](https://www.tricentis.com/products/unified-test-management-qtest/features)
- [Tricentis qTest Copilot](https://tricentis.com/products/unified-test-management-qtest/copilot)
- [Introducing qTest Copilot (Tricentis blog)](https://www.tricentis.com/blog/introducing-qtest-copilot-ai-powered-assistant)
- [qTest docs: Optimize your testing with AI](https://docs.tricentis.com/qtest-saas/content/manager/ai_integration/ai_functions.htm)
- [qTest Copilot availability (ShiftSync)](https://shiftsync.tricentis.com/product-updates/tricentis-qtest-copilot-is-now-available-1755?postid=10)
- [Capterra: Tricentis qTest](https://www.capterra.com/p/173762/qTest/)
- [GetApp: qTest](https://www.getapp.com/development-tools-software/a/qtest/)
- [GetApp reviews: qTest](https://www.getapp.com/development-tools-software/a/qtest/reviews/)
