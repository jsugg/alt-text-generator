// supertest ships no bundled types and no @types package is installed; the
// ambient shim keeps the request/agent boundary `any` (same approach as the
// express shim) while local JSDoc types the callers.
declare module 'supertest';
