# Postman / Newman Standards

This document defines the contribution standards for the API contract suite.

## Purpose

Use the Postman/Newman layer for external HTTP contract validation, not for re-testing every unit of business logic already covered by Jest.

## Test Tiers

- `smoke`
  - Fast deterministic checks required on pull requests
  - Covers core health/docs/routing, protected-endpoint auth, and one representative provider path
- `full`
  - Full deterministic harness for `main` and `production`
  - Adds broader contract, negative-path, and page-description coverage
- `live`
  - Manual or scheduled validation against real providers
  - Must never be a required PR gate
- `deploy`
  - Hosted post-promotion smoke verification against the deployed service

## Naming

- Top-level folders are tiered and ordered numerically: `00`, `05`, `10`, `20`, etc.
- Request names should describe the user-visible behavior, not the implementation detail.
- Negative-path request names should state both the scenario and the expected outcome.

## Placement Rules

- Put a scenario in Newman when the main risk is:
  - request/response contract drift
  - routing, redirects, docs, or auth behavior
  - black-box provider integration shape
- Put a scenario in Jest/Supertest when the main risk is:
  - service orchestration
  - internal invariants
  - algorithmic branching
  - startup/runtime composition

## Assertions

- Prefer asserting the public contract shape, not internal implementation details.
- For error responses, assert:
  - `error`
  - `code`
  - `requestId` presence when applicable
  - `details` only when the endpoint is expected to emit validation details
- Use exact equality only when the response contract is intentionally minimal and stable.

## Failure Expectations

- Use `X-Expected-Status-Class: 5xx` only for requests that intentionally exercise server/provider failure paths.
- Do not use the expected-status override to hide flaky behavior.

## Data Policy

- Deterministic tiers must use local fixtures or stubbed providers.
- Live tiers must use stable public URLs with a history of working in production.
- Avoid examples that rely on placeholder domains such as `example.com`.

## Review Checklist

- Folder placement matches the intended tier.
- The request name is user-facing and precise.
- Assertions validate the contract shape, not just status code.
- New negative paths do not weaken the deterministic suite.
- Live validations remain opt-in and credential-gated.
