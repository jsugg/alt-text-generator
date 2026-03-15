# Jobs

Updated: 2026-03-14 11:28:05Z

## Initial Context

- Project: `alt-text-generator`
- Current production symptom:
  - `replicate` requests to `https://wcag.qcraft.com.br/api/v1/accessibility/description` hang for a long time and do not return a response body in a reasonable window.
  - Verified behavior:
    - `azure`, `huggingface`, `openai`, `openrouter`, and `together` returned `200` with usable descriptions.
    - `ollama` is not enabled in production and returns `400 UNKNOWN_MODEL`.
    - `replicate` timed out at 20s, 45s, and 120s with `curl` receiving `0` bytes.
- Current implementation:
  - The Replicate provider is wired by `src/providers/definitions/replicate.js`.
  - The request path blocks on `replicate.run()` inside `src/services/ReplicateDescriberService.js`.
  - The single-image controller awaits `describer.describeImage(imageSource)` directly inside the user request lifecycle.
  - The page-description controller and service also reuse the same provider path.

## Analysis

### What the code is doing today

- `DescriptionController.describe()` logs the request and awaits the provider inline.
- `DescriptionController.describePage()` does the same at the page-orchestration level.
- `ReplicateDescriberService.describeImage()` calls:

```js
const output = await this.replicate.run(modelRef, {
  input: { image: imageUrl },
});
```

- There is no provider-specific timeout, no prediction ID logging, no async job abstraction, and no dedicated timeout-to-HTTP mapping for slow providers.
- Current error mapping for description failures is generic `500 DESCRIPTION_FETCH_FAILED`.

### Production evidence

- Render logs show `replicate` requests reaching the app and logging `Generating alt text` with:
  - model ref `rmokady/clip_prefix_caption:9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8`
- The same logs show request completion only after the client had already disconnected, with null/unfinished response state on the app side.
- This means the app is not rejecting the request quickly; it is waiting too long on upstream prediction completion.

### External documentation findings

- Replicate JavaScript client:
  - `run()` creates a prediction and then waits for completion.
  - It supports `signal`, `progress`, `webhook`, and `webhook_events_filter`.
  - It also exposes `predictions.create`, `predictions.get`, and `predictions.cancel`.
- Replicate prediction docs:
  - Sync waiting is intended for short-running models.
  - Polling / asynchronous prediction handling is the correct pattern for longer-running work.
- Replicate model docs for `rmokady/clip_prefix_caption`:
  - Typical runtime is materially longer than the "few seconds" sync sweet spot.
  - Runtime is variable.
- Replicate warm-model docs:
  - Cold boots can take minutes, especially for public models or low-traffic models.
- Replicate status page:
  - No broad platform outage was indicated at the time of inspection.

### Root-cause assessment

- The core problem is architectural: a user-facing synchronous HTTP endpoint is directly coupled to an upstream prediction path with variable and sometimes very long latency.
- The current code path is acceptable for fast providers and a poor fit for slow or bursty providers like public Replicate models.
- Increasing the HTTP timeout is not a real fix.
- Moving to a dedicated Replicate deployment would improve latency, but by itself it would not fix the fundamental coupling between the HTTP request and the prediction lifecycle.

### Design options considered

1. Raise the timeout.
   - Rejected as insufficient.
   - Still couples client latency to upstream runtime.

2. Keep sync behavior, add a shorter provider timeout, and return `504`.
   - Good hardening step.
   - Still not the best final architecture.

3. Switch `replicate` to an asynchronous prediction workflow with job status and result caching.
   - Best fit for long-running or bursty providers.
   - Clean separation between request lifecycle and prediction lifecycle.
   - Compatible with a future warm deployment if needed.

4. Add Replicate webhooks immediately.
   - Strong option, but requires more external configuration and route/auth design.
   - Good follow-up if needed.

## Selected Implementation Plan

### Goal

Implement a robust async `replicate` flow for single-image descriptions, while also hardening the legacy synchronous `replicate` usage so it fails cleanly instead of hanging indefinitely.

### Scope

- Add durable description job orchestration for async-capable providers, starting with `replicate`.
- Keep existing synchronous behavior for fast providers.
- Keep Swagger/OpenAPI docs current.
- Add tests for controller behavior, job orchestration, and Replicate provider behavior.

### Planned architecture

1. Add a small description-job abstraction:
   - `DescriptionJobService`
   - job store interface
   - in-memory implementation
   - Redis-backed implementation when configured

2. Give async-capable providers optional methods:
   - `createDescriptionJob(imageUrl)`
   - `getDescriptionJob(jobId)`

3. Extend `ReplicateDescriberService`:
   - keep `describeImage(imageUrl, options)` for synchronous callers
   - add provider timeout / abort support
   - add prediction-ID-aware async job methods built on `predictions.create` and `predictions.get`

4. Update the single-image controller:
   - fast providers: unchanged `200`
   - async providers like `replicate`:
     - return cached result immediately if available
     - otherwise start/reuse a job
     - wait a short bounded window
     - return `200` if the job completes quickly
     - return `202` with job metadata if still pending

5. Add a job-status endpoint:
   - `GET /api/v1/accessibility/description-jobs/:jobId`

6. Improve error mapping:
   - provider timeout => `504 DESCRIPTION_PROVIDER_TIMEOUT`
   - job not found => `404 DESCRIPTION_JOB_NOT_FOUND`

7. Update docs and tests:
   - Swagger annotations
   - generated OpenAPI artifact
   - unit/integration coverage

### Design constraints

- Preserve clean separation between controllers, orchestration, provider gateways, and storage.
- Avoid coupling non-HTTP services to Express.
- Keep the smallest safe public API expansion.
- Do not rely on in-memory-only state as the sole "robust" strategy; provide a Redis path and a clean fallback.
- Do not regress the fast providers.

### Validation plan

- Run targeted unit tests for new services and controllers.
- Run integration tests for the new async `replicate` flow.
- Run full `npm test`.
- Run `npm run lint`.
- Regenerate and validate Swagger/OpenAPI docs.
- Re-check Replicate docs / SDK behavior against the implementation before reporting back.

## Follow-up Adjustment

### New requirement

- The page-description endpoint must not fail fast for async-capable providers.
- It must support asynchronous page-description requests gracefully, securely,
  and robustly, using the same design standards as the single-image async flow.

### Updated implementation approach

1. Add a dedicated `PageDescriptionJobService` above `PageDescriptionService`.
2. Extend `PageDescriptionService` with an async-capable execution path that
   waits on provider jobs (`createDescriptionJob` / `getDescriptionJob`) rather
   than calling the synchronous `describeImage()` timeout path for every image.
3. Add a page-description job status endpoint:
   - `GET /api/v1/accessibility/page-description-jobs/:jobId`
4. Reuse the existing description-job store for both image and page jobs.
5. Make page jobs depend on the persisted single-image description jobs so page
   retries and process restarts can reuse existing upstream prediction state
   instead of blindly starting fresh provider work for every image again.
6. Add lease-aware job claiming so one runner owns a pending page job at a time,
   with heartbeat refresh while background execution is active.
7. Update Swagger/OpenAPI, README, DEVELOPMENT, `.env.example`, and tests to
   reflect `202 Accepted` page-description behavior.
