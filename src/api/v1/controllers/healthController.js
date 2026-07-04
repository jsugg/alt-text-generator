const packageMetadata = require('../../../../package.json');

/**
 * @typedef {object} HttpRequest
 * @property {string} [id]
 */

/**
 * @typedef {object} HttpResponse
 * @property {(code: number) => HttpResponse} status
 * @property {(body: unknown) => HttpResponse} json
 * @property {(body: unknown) => HttpResponse} send
 */

const ROOT_INDEX_LINKS = Object.freeze({
  api: '/api/v1',
  docs: '/api-docs/',
  health: '/api/health',
  ping: '/api/ping',
});

const SUPPORTED_API_AUTH_SCHEMES = Object.freeze(['X-API-Key', 'Bearer']);
const defaultRuntimeState = Object.freeze({
  isReady: () => true,
});

/**
 * @param {string} [requestId]
 */
const buildServiceIndexResponse = (requestId) => ({
  name: packageMetadata.name,
  version: packageMetadata.version,
  status: 'ok',
  links: ROOT_INDEX_LINKS,
  auth: {
    schemes: SUPPORTED_API_AUTH_SCHEMES,
  },
  requestId,
});

const buildHealthResponse = ({
  now = Date.now,
  ready = true,
  uptime = process.uptime,
}) => ({
  message: ready ? 'OK' : 'DRAINING',
  ready,
  timestamp: now(),
  uptime: uptime(),
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: Get the public service index
 *     description: Returns a stable discovery document for the public API surface.
 *     responses:
 *       200:
 *         description: Public service metadata and discovery links
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - name
 *                 - version
 *                 - status
 *                 - links
 *                 - auth
 *                 - requestId
 *               properties:
 *                 name:
 *                   type: string
 *                   example: alt-text-generator
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 *                 status:
 *                   type: string
 *                   example: ok
 *                 links:
 *                   type: object
 *                   required:
 *                     - api
 *                     - docs
 *                     - health
 *                     - ping
 *                   properties:
 *                     api:
 *                       type: string
 *                       example: /api/v1
 *                     docs:
 *                       type: string
 *                       example: /api-docs/
 *                     health:
 *                       type: string
 *                       example: /api/health
 *                     ping:
 *                       type: string
 *                       example: /api/ping
 *                 auth:
 *                   type: object
 *                   required:
 *                     - schemes
 *                   properties:
 *                     schemes:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example:
 *                         - X-API-Key
 *                         - Bearer
 *                 requestId:
 *                   type: string
 *       500:
 *         description: Server error
 */
/**
 * @param {HttpRequest} req
 * @param {HttpResponse} res
 * @returns {HttpResponse}
 */
const index = (req, res) => res.status(200).json(buildServiceIndexResponse(req.id));

/**
 * @swagger
 * /api/ping:
 *   get:
 *     summary: Check if the API is available
 *     responses:
 *       200:
 *         description: API is online and listening
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: pong
 *       500:
 *         description: Server error
 */
/**
 * @param {HttpRequest} req
 * @param {HttpResponse} res
 * @returns {HttpResponse}
 */
const ping = (req, res) => res.status(200).send('pong');

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Check if the API is ready to serve traffic
 *     responses:
 *       200:
 *         description: API is online and ready
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - message
 *                 - ready
 *                 - timestamp
 *                 - uptime
 *               properties:
 *                 uptime:
 *                   type: number
 *                 message:
 *                   type: string
 *                   example: OK
 *                 ready:
 *                   type: boolean
 *                   example: true
 *                 timestamp:
 *                   type: number
 *       503:
 *         description: API is draining and should be removed from service
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - message
 *                 - ready
 *                 - timestamp
 *                 - uptime
 *               properties:
 *                 uptime:
 *                   type: number
 *                 message:
 *                   type: string
 *                   example: DRAINING
 *                 ready:
 *                   type: boolean
 *                   example: false
 *                 timestamp:
 *                   type: number
 */
const createHealthController = ({
  now = Date.now,
  runtimeState = defaultRuntimeState,
  uptime = process.uptime,
} = {}) => {
  /**
   * @param {HttpRequest} req
   * @param {HttpResponse} res
   * @returns {HttpResponse}
   */
  const health = (req, res) => {
    const ready = runtimeState.isReady();
    const payload = buildHealthResponse({
      now,
      ready,
      uptime,
    });

    return res.status(ready ? 200 : 503).json(payload);
  };

  return {
    health,
    index,
    ping,
  };
};

module.exports = {
  buildServiceIndexResponse,
  buildHealthResponse,
  ...createHealthController(),
  createHealthController,
  index,
  ping,
};
