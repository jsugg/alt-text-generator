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

module.exports = { ping, health };
