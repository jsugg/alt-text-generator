// Ambient shim: express ships no bundled types, and @types/express would
// fight the repo's duck-typed controller/request shapes (ControllerRequest,
// ControllerResponse, ...). The shorthand declaration keeps the express
// boundary explicitly `any`; handler and router shapes stay typed via local
// JSDoc typedefs at each call site.
declare module 'express';
