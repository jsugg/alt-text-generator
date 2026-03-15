const { isValidUrl } = require('../../../utils/urlValidator');
const { normalizeImageSource } = require('../../../utils/imageSource');
const { ApiError } = require('../../../errors/ApiError');
const { isProviderTimeoutError } = require('../../../errors/ProviderTimeoutError');
const { DescriptionJobService, isPendingStatus } = require('../../../services/DescriptionJobService');

const buildRequiredQueryDetails = (fields) => fields.map((field) => ({
  field,
  issue: 'required',
}));

/**
 * Handles requests to generate alt-text descriptions for images.
 */
class DescriptionController {
  /**
   * @param {object} deps
   * @param {object} deps.imageDescriberFactory - ImageDescriberFactory instance
   * @param {object} deps.pageDescriptionService - PageDescriptionService instance
   * @param {object} deps.descriptionJobService - DescriptionJobService instance
   * @param {object} deps.pageDescriptionJobService - PageDescriptionJobService instance
   * @param {object} deps.logger - pino logger instance
   */
  constructor({
    imageDescriberFactory,
    pageDescriptionService,
    descriptionJobService,
    pageDescriptionJobService,
    logger,
  }) {
    this.factory = imageDescriberFactory;
    this.pageDescriptionService = pageDescriptionService;
    this.descriptionJobService = descriptionJobService;
    this.pageDescriptionJobService = pageDescriptionJobService;
    this.logger = logger;
    this.describe = this.describe.bind(this);
    this.describePage = this.describePage.bind(this);
    this.getDescriptionJob = this.getDescriptionJob.bind(this);
    this.getPageDescriptionJob = this.getPageDescriptionJob.bind(this);
  }

  /**
   * @swagger
   * /api/accessibility/description:
   *   get:
   *     summary: Returns a description for a given image
   *     description: Takes an image URL and sends it to the selected AI model
   *       to generate an alt-text description. Slow asynchronous providers such
   *       as `replicate` can return `202 Accepted` with a job status payload.
   *     security:
   *       - bearerAuth: []
   *       - apiKeyAuth: []
   *     parameters:
   *       - name: image_source
   *         in: query
   *         description: URLEncoded address of the image.
   *         required: true
   *         schema:
   *           type: string
   *           example: https%3A%2F%2Fdeveloper.chrome.com%2Fstatic%2Fimages%2Fai-homepage-card.png
   *       - name: model
   *         in: query
   *         description: The AI model to use, for example `replicate`, `azure`,
   *           `ollama`, `huggingface`, `openai`, `openrouter`, or `together`.
   *         required: true
   *         schema:
   *           type: string
   *           enum:
   *             - replicate
   *             - azure
   *             - ollama
   *             - huggingface
   *             - openai
   *             - openrouter
   *             - together
   *           example: replicate
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   description:
   *                     type: string
   *                     example: A man with glasses is playing a violin.
   *                   imageUrl:
   *                     type: string
   *                     example: https://developer.chrome.com/static/images/ai-homepage-card.png
   *       202:
   *         description: Description job accepted and still processing
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/DescriptionJobResponse'
   *       400:
   *         description: Missing or invalid parameters, or unsupported model
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       401:
   *         description: Missing or invalid API authentication credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       504:
   *         description: Description provider timed out before completing the request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   */
  async describe(req, res, next) {
    const requestLogger = req.log ?? this.logger;
    const { image_source: rawImageSource, model } = req.query;
    const missingFields = ['image_source', 'model'].filter((field) => !req.query[field]);

    if (missingFields.length > 0) {
      return next(ApiError.badRequest({
        message: 'Missing required query parameters: image_source and model',
        code: 'QUERY_VALIDATION_ERROR',
        details: buildRequiredQueryDetails(missingFields),
      }));
    }

    const imageSource = normalizeImageSource(rawImageSource);

    if (!isValidUrl(imageSource)) {
      return next(ApiError.badRequest({
        message: 'Invalid image_source URL',
        code: 'INVALID_IMAGE_SOURCE_URL',
        details: [{ field: 'image_source', issue: 'invalid_url' }],
      }));
    }

    requestLogger.info({ model, imageSource }, 'Description request');

    try {
      const describer = this.factory.get(model);
      if (DescriptionJobService.supportsAsyncJobs(describer)) {
        const outcome = await this.descriptionJobService.resolveDescription({
          model,
          imageUrl: imageSource,
        });

        if (outcome.kind === 'completed') {
          return res.json([outcome.result]);
        }

        return res.status(202).json(this.descriptionJobService.buildJobResponse(outcome.job));
      }

      const result = await describer.describeImage(imageSource);
      return res.json([result]);
    } catch (error) {
      // factory.get() throws a user-facing error for unknown models
      if (error.message.startsWith('Unknown model')) {
        return next(ApiError.badRequest({
          message: error.message,
          code: 'UNKNOWN_MODEL',
          details: [{ field: 'model', issue: 'unsupported_value' }],
        }));
      }

      if (isProviderTimeoutError(error)) {
        return next(ApiError.gatewayTimeout({
          message: 'Description provider timed out before completing the request',
          code: 'DESCRIPTION_PROVIDER_TIMEOUT',
        }));
      }

      return next(ApiError.internal({
        message: 'Error fetching description for the provided image',
        code: 'DESCRIPTION_FETCH_FAILED',
        cause: error,
      }));
    }
  }

  /**
   * @swagger
   * /api/accessibility/descriptions:
   *   get:
   *     summary: Returns descriptions for images found on a page
   *     description: Scrapes a website, preserves duplicate image entries in page
   *       order, and reuses a single prediction per unique image URL. Slow
   *       asynchronous providers such as `replicate` can return `202 Accepted` with
   *       a page-description job payload.
   *     security:
   *       - bearerAuth: []
   *       - apiKeyAuth: []
   *     parameters:
   *       - name: url
   *         in: query
   *         description: URLEncoded address of the target website.
   *         required: true
   *         schema:
   *           type: string
   *           example: https%3A%2F%2Fdeveloper.chrome.com%2F
   *       - name: model
   *         in: query
   *         description: The AI model to use, for example `replicate`, `azure`,
   *           `ollama`, `huggingface`, `openai`, `openrouter`, or `together`.
   *         required: true
   *         schema:
   *           type: string
   *           enum:
   *             - replicate
   *             - azure
   *             - ollama
   *             - huggingface
   *             - openai
   *             - openrouter
   *             - together
   *           example: replicate
   *     responses:
   *       200:
   *         description: OK
   *       202:
   *         description: Page-description job accepted and still processing
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PageDescriptionJobResponse'
   *       400:
   *         description: Missing or invalid parameters, or unsupported model
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       401:
   *         description: Missing or invalid API authentication credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       504:
   *         description: Description provider timed out before completing the request
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   */
  async describePage(req, res, next) {
    const requestLogger = req.log ?? this.logger;
    const { url: rawPageUrl, model } = req.query;
    const missingFields = ['url', 'model'].filter((field) => !req.query[field]);

    if (missingFields.length > 0) {
      return next(ApiError.badRequest({
        message: 'Missing required query parameters: url and model',
        code: 'QUERY_VALIDATION_ERROR',
        details: buildRequiredQueryDetails(missingFields),
      }));
    }

    const pageUrl = decodeURIComponent(rawPageUrl);

    if (!isValidUrl(pageUrl)) {
      return next(ApiError.badRequest({
        message: 'Invalid url parameter',
        code: 'INVALID_PAGE_URL',
        details: [{ field: 'url', issue: 'invalid_url' }],
      }));
    }

    requestLogger.info({ model, pageUrl }, 'Page description request');

    try {
      const describer = this.factory.get(model);
      if (DescriptionJobService.supportsAsyncJobs(describer)) {
        const outcome = await this.pageDescriptionJobService.resolvePageDescription({
          model,
          pageUrl,
        });

        if (outcome.kind === 'completed') {
          return res.json(outcome.result);
        }

        return res.status(202).json(this.pageDescriptionJobService.buildJobResponse(outcome.job));
      }

      const result = await this.pageDescriptionService.describePage({
        pageUrl,
        model,
      });
      return res.json(result);
    } catch (error) {
      if (error.message.startsWith('Unknown model')) {
        return next(ApiError.badRequest({
          message: error.message,
          code: 'UNKNOWN_MODEL',
          details: [{ field: 'model', issue: 'unsupported_value' }],
        }));
      }

      if (isProviderTimeoutError(error)) {
        return next(ApiError.gatewayTimeout({
          message: 'Description provider timed out before completing the request',
          code: 'DESCRIPTION_PROVIDER_TIMEOUT',
        }));
      }

      return next(ApiError.internal({
        message: 'Error fetching descriptions for the provided page',
        code: 'PAGE_DESCRIPTION_FETCH_FAILED',
        cause: error,
      }));
    }
  }

  /**
   * @swagger
   * /api/accessibility/page-description-jobs/{jobId}:
   *   get:
   *     summary: Returns the current status of an asynchronous page-description job
   *     description: Poll this endpoint after a `202 Accepted` response from the
   *       page-description route.
   *     security:
   *       - bearerAuth: []
   *       - apiKeyAuth: []
   *     parameters:
   *       - name: jobId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Job has completed or failed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PageDescriptionJobResponse'
   *       202:
   *         description: Job is still processing
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PageDescriptionJobResponse'
   *       401:
   *         description: Missing or invalid API authentication credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       404:
   *         description: Page-description job not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   */
  async getPageDescriptionJob(req, res, next) {
    const { jobId } = req.params;

    if (!jobId || typeof jobId !== 'string') {
      return next(ApiError.badRequest({
        message: 'Missing required path parameter: jobId',
        code: 'QUERY_VALIDATION_ERROR',
        details: [{ field: 'jobId', issue: 'required' }],
      }));
    }

    try {
      const job = await this.pageDescriptionJobService.getJobStatus(jobId);
      if (!job) {
        return next(ApiError.notFound({
          message: 'Page-description job not found',
          code: 'PAGE_DESCRIPTION_JOB_NOT_FOUND',
        }));
      }

      const responseBody = this.pageDescriptionJobService.buildJobResponse(job);
      return res.status(isPendingStatus(job.status) ? 202 : 200).json(responseBody);
    } catch (error) {
      return next(ApiError.internal({
        message: 'Error fetching page-description job status',
        code: 'PAGE_DESCRIPTION_JOB_FETCH_FAILED',
        cause: error,
      }));
    }
  }

  /**
   * @swagger
   * /api/accessibility/description-jobs/{jobId}:
   *   get:
   *     summary: Returns the current status of an asynchronous description job
   *     description: Poll this endpoint after a `202 Accepted` response from the
   *       single-image description route.
   *     security:
   *       - bearerAuth: []
   *       - apiKeyAuth: []
   *     parameters:
   *       - name: jobId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Job has completed or failed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/DescriptionJobResponse'
   *       202:
   *         description: Job is still processing
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/DescriptionJobResponse'
   *       401:
   *         description: Missing or invalid API authentication credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       404:
   *         description: Description job not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       504:
   *         description: Description provider timed out while checking job status
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ApiErrorResponse'
   */
  async getDescriptionJob(req, res, next) {
    const { jobId } = req.params;

    if (!jobId || typeof jobId !== 'string') {
      return next(ApiError.badRequest({
        message: 'Missing required path parameter: jobId',
        code: 'QUERY_VALIDATION_ERROR',
        details: [{ field: 'jobId', issue: 'required' }],
      }));
    }

    try {
      const job = await this.descriptionJobService.getJobStatus(jobId);
      if (!job) {
        return next(ApiError.notFound({
          message: 'Description job not found',
          code: 'DESCRIPTION_JOB_NOT_FOUND',
        }));
      }

      const responseBody = this.descriptionJobService.buildJobResponse(job);
      return res.status(isPendingStatus(job.status) ? 202 : 200).json(responseBody);
    } catch (error) {
      if (isProviderTimeoutError(error)) {
        return next(ApiError.gatewayTimeout({
          message: 'Description provider timed out while checking job status',
          code: 'DESCRIPTION_PROVIDER_TIMEOUT',
        }));
      }

      return next(ApiError.internal({
        message: 'Error fetching description job status',
        code: 'DESCRIPTION_JOB_FETCH_FAILED',
        cause: error,
      }));
    }
  }
}

module.exports = DescriptionController;
