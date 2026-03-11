const packageMetadata = require('../../../../package.json');

const ROOT_INDEX_LINKS = Object.freeze({
  api: '/api/v1',
  docs: '/api-docs/',
  health: '/api/health',
  ping: '/api/ping',
});

const SUPPORTED_API_AUTH_SCHEMES = Object.freeze(['X-API-Key', 'Bearer']);

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
const ping = (req, res) => res.status(200).send('pong');

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Check if the API is healthy
 *     responses:
 *       200:
 *         description: API is online and healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uptime:
 *                   type: number
 *                 message:
 *                   type: string
 *                   example: OK
 *                 timestamp:
 *                   type: number
 *       500:
 *         description: Server error
 */
const health = (req, res) => res.json({
  uptime: process.uptime(),
  message: 'OK',
  timestamp: Date.now(),
});

module.exports = {
  buildServiceIndexResponse,
  health,
  index,
  ping,
};
