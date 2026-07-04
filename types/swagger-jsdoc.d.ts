// Ambient shim: swagger-jsdoc ships no bundled types and no @types package is
// installed. It is only used as a dev-time fallback to regenerate the OpenAPI
// spec when the committed artifact is missing, so keep the boundary `any`.
declare module 'swagger-jsdoc';
