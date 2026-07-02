# Security Policy

## Supported versions

| Surface | Supported |
|---|---|
| `production` branch (deployed service) | Yes — receives fixes via promotion from `main` |
| `main` branch | Yes — active development |
| Anything else (forks, old commits) | No |

## Reporting a vulnerability

Please use GitHub private vulnerability reporting: open
[Security → Advisories → Report a vulnerability](https://github.com/jsugg/alt-text-generator/security/advisories/new)
on this repository. Do not open a public issue for security reports.

What to include: affected endpoint/component, reproduction steps or proof of
concept, impact assessment, and any suggested fix.

This is a single-maintainer project: expect acknowledgement within 7 days and
a fix or mitigation plan within 30 days for confirmed issues. Coordinated
disclosure is appreciated; you will be credited in the advisory unless you ask
otherwise.

## Scope notes

- The deployed API enforces HTTPS, rate limiting, and optional token-based
  access control for cost-bearing endpoints.
- Secrets are never stored in the repository: provider keys live in the
  `prod-validation` GitHub environment and the Render dashboard
  (`sync: false` in `render.yaml`).
- Dependency and code scanning run continuously (Dependabot alerts + security
  updates, CodeQL `security-extended`, secret scanning with push protection,
  weekly `npm audit` gate).
