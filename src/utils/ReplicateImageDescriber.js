require('dotenv').config();
const Replicate = require('replicate');
const axios = require('axios');

/**
 * Class: ReplicateImageDescriber
 *
 * Provides methods for converting image URLs to data URLs, polling an endpoint,
 * and generating alt text for images using a specified model.
 *
 * Example Usage:
 *
 * const imageObject = {
 *   imagesSource: ['https://example.com/image.jpg']
 * };
 *
 * ReplicateImageDescriber.setUp({ userAgent: 'alt-text-generator/1.0.0' });
 * const altTextList = await ReplicateImageDescriber.describeImage(imageObject);
 * console.log(altTextList);
 *
 * Inputs:
 * - imageObject: An object that contains an array of image URLs under the key 'imagesSource'.
 *
 * Flow:
 * 1. The code sets up the ReplicateImageDescriber class by calling the setUp method with
 *    the desired user agent.
 * 2. The describeImage method is called with an imageObject as input.
 * 3. The imagesObjectToArray method is called to convert the image URLs in the imageObject
 *    to data URLs.
 * 4. The urlToDataURL method is called to fetch each image URL and convert it to a data URL.
 * 5. The replicate.run method is called to generate alt text for each image using a
 *    specified model.
 * 6. The alt text and image URL are added to the altTextList array.
 * 7. The altTextList is returned as the output.
 *
 * Outputs:
 * - altTextList: An array of objects containing the alt text and image URL
 * for each image in the imageObject.
 */
class ReplicateImageDescriber {
  static replicate;

  static delayBetweenRequests = 10;

  static altTextList = [];

  static log;

  static fetch = null;

  /**
   * Set up the logger for the ReplicateImageDescriber class.
   *
   * @param {Object} options - Optional parameters for the function.
   * @param {Object} options.logger - The logger to be used for logging.
   * @return {undefined} This function does not return anything.
   */
  static use({ logger } = {}) {
    if (logger) {
      ReplicateImageDescriber.log = logger;
    } else {
      ReplicateImageDescriber.log = this.log;
    }
  }

  /**
   * Set up the ReplicateImageDescriber with the provided options.
   *
   * @param {Object} options - The options for setting up the ReplicateImageDescriber.
   * @param {string} options.auth - The authentication token for the Replicate API.
   * @param {string} options.baseUrl - The base URL for the Replicate API.
   * @param {string} options.userAgent - The user agent for the Replicate API.
   * @return {void} This function does not return anything.
   */
  static setUp(options = {}) {
    const newOptions = { ...options };
    newOptions.auth = newOptions.auth || process.env.REPLICATE_API_TOKEN;
    newOptions.baseUrl = newOptions.baseUrl || process.env.REPLICATE_API_ENDPOINT;
    newOptions.userAgent = newOptions.userAgent || process.env.REPLICATE_USER_AGENT;
    ReplicateImageDescriber.replicate = new Replicate(newOptions);
  }

  /**
   * Asynchronously polls the specified endpoint at a given interval.
   *
   * @param {string} url - The URL of the endpoint to poll.
   * @param {number} interval - The interval in milliseconds at which to poll the endpoint.
   * @return {Promise<any>} A promise that resolves to the final status of the poll.
   */
  static async pollEndpoint(url, interval) {
    const token = ReplicateImageDescriber.replicate.options.auth;
    const headers = {
      Authorization: `Token ${token}`,
    };

    const poll = async () => {
      try {
        const response = await axios.get(url, { headers });
        if (response.status === 200) {
          const { status } = JSON.parse(response.data);
          if (['succeeded', 'failed', 'canceled'].includes(status)) {
            return status;
          }
        } else if (response.status > 203) {
          return response.status;
        }
      } catch (error) {
        this.log.logger.error(`Error polling endpoint: ${error}`);
      }

      // Wait for the specified interval before polling again
      await new Promise((resolve) => { setTimeout(resolve, interval); });

      return poll();
    };

    return poll();
  }

  /**
   * Creates a delay for a specified interval.
   *
   * @param {number} interval - The interval in milliseconds.
   * @return {Promise} A promise that resolves after the specified interval.
   */
  static delay(interval) {
    return new Promise((resolve) => { setTimeout(resolve, interval); });
  }

  /**
   * Generates alt text for an image using the ReplicateImageDescriber model.
   *
   * @param {string} imageUrl - The URL of the image to generate alt text for.
   * @return {Array} An array with an alt text description and its corresponding image URL.
   */
  static async describeImage(imageUrl) {
    try {
      const modelOwner = 'rmokady';
      const modelName = 'clip_prefix_caption';
      const modelLatestVersion = '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8';

      ReplicateImageDescriber.log.logger.info('Generating alt text...');
      const output = await ReplicateImageDescriber.replicate.run(
        `${modelOwner}/${modelName}:${modelLatestVersion}`,
        {
          input: {
            image: imageUrl,
          },
        },
      );
      ReplicateImageDescriber.altTextList.push({
        description: output,
        imageUrl,
      });
      ReplicateImageDescriber.log.logger.debug(
        `Alt text generated for ${imageUrl}`,
      );
      return ReplicateImageDescriber.altTextList;
    } catch (error) {
      ReplicateImageDescriber.log.logger.info(
        `Error fetching descriptions, ${error}`,
      );
      return '';
    }
  }
}

ReplicateImageDescriber.setUp({ userAgent: 'alt-text-generator/1.0.0' });

module.exports = ReplicateImageDescriber;
