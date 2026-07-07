// Ambient shim: swagger-ui-express ships no bundled types and no @types
// package is installed. The docs UI is lazy-required behind the /api-docs
// route, so keep the boundary explicitly `any` — the surrounding handler and
// router shapes stay typed via local JSDoc typedefs at the call site.
declare module 'swagger-ui-express';
