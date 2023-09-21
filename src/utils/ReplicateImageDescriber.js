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
 * Converts an image URL to a data URL and returns it along with additional options.
 *
 * This method fetches an image from a given URL, converts it to a base64-encoded data URL,
 * and returns the data URL along with additional options such as content length.
 *
 * @async
 * @static
 * @param {string} url - The URL of the image to be converted.
 * @returns {Promise<Object>} An object containing the data URL and additional options.
 * @returns {string} Object.dataURL - The base64-encoded data URL of the image.
 * @returns {Object} Object.options - Additional options, currently only includes 'Content-Length'.
 *
 * @example
 * const { dataURL, options } = await ReplicateImageDescriber.urlToDataURL('https://example.com/image.jpg');
 */
  static async urlToDataURL(url) {
    ReplicateImageDescriber.log.logger.info(
      'Converting image URL to dataURL... Fetching image',
    );
    if (!this.fetch) {
      this.fetch = (await import('node-fetch')).default;
    }
    const response = await this.fetch(url);
    ReplicateImageDescriber.log.logger.info(
      'Converting image URL to dataURL... Fetching image... Done.',
    );
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type');
    const fileExtension = contentType.split('/')[1];
    const base64Data = Buffer.from(buffer).toString('base64');
    const dataURL = `data:${contentType};base64,${base64Data}.${fileExtension}`;
    const dataURLWithoutPrefix = dataURL.slice(dataURL.indexOf(',') + 1);
    const decodedData = Buffer.from(dataURLWithoutPrefix, 'base64');
    const contentLength = decodedData.byteLength;
    const headers = { 'Content-Length': contentLength };
    const options = { headers };

    ReplicateImageDescriber.log.logger.info(
      'Converting image URL to dataURL... Done.',
    );
    return { dataURL, options };
  }

  /**
 * Converts an object containing image URLs to an array of objects containing data URLs.
 *
 * @static
 * @async
 * @param {Object} imagesObject - The object containing image URLs.
 * @param {Array} imagesObject.imagesSource - An array of image URLs to be converted.
 *
 * @returns {Promise<Array>} Returns a promise that resolves to an array of objects,
 * each containing a data URL representation of the image.
 *
 * @example
 * const imagesObject = { imagesSource: ['http://example.com/image1.jpg', 'http://example.com/image2.jpg'] };
 * const result = await ReplicateImageDescriber.imagesObjectToArray(imagesObject);
 * console.log(result); // Output will be an array of objects containing data URLs.
 */

  static async imagesObjectToArray(imagesObject) {
    ReplicateImageDescriber.log.logger.debug(
      `Converting image URLs to dataURLs... imagesObject: ${imagesObject}...`,
    );
    // const imageSources = JSON.parse(imagesObject)["imagesSource"];
    const imageSources = imagesObject.imagesSource[0];
    ReplicateImageDescriber.log.logger.debug(
      `Converting image URLs to dataURLs... imageSources: ${imageSources}...`,
    );

    ReplicateImageDescriber.log.logger.debug(
      'Converting image URLs to dataURLs...',
    );
    const imageFilesObject = await ReplicateImageDescriber.urlToDataURL(
      imageSources,
    );

    ReplicateImageDescriber.log.logger.debug(
      'Converting image URLs to dataURLs... Done.',
    );
    return imageFilesObject;
  }

  /**
   * Generates alt text for a list of images.
   *
   * @param {object} imagesObject - The object containing the images.
   * @return {array} An array of objects containing the image URL and its alt text.
   */
  static async describeImages(imagesObject) {
    try {
      ReplicateImageDescriber.log.logger.debug(`Generating imageFileObjectArray for ${imagesObject}`);
      const imageFilesObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imagesObject);
      const dataURLArray = imageFilesObjectArray.map((obj) => obj.dataURL);
      const modelOwner = 'rmokady';
      const modelName = 'clip_prefix_caption';
      const modelLatestVersion = '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8';

      ReplicateImageDescriber.log.logger.debug(`Generating alt text for ${imageFilesObjectArray.length} images. Model: ${modelOwner}/${modelName}:${modelLatestVersion}.`);

      const altTextList = await Promise.all(
        dataURLArray.map(async (img) => {
          ReplicateImageDescriber.log.logger.debug(`Generating alt text for image: ${img}...`);
          const output = await ReplicateImageDescriber.replicate.run(
            `${modelOwner}/${modelName}:${modelLatestVersion}`,
            {
              input: {
                image: img,
              },
            },
          );
          ReplicateImageDescriber.log.logger.debug(`Generating alt text for image: ${img}... Done. Alt text: ${output}`);
          await ReplicateImageDescriber.delay(ReplicateImageDescriber.delayBetweenRequests);
          return {
            image: img,
            description: output,
          };
        }),
      );

      ReplicateImageDescriber.log.logger.info(`Alt text generated for ${imageFilesObjectArray.length} images. altTextList: ${JSON.stringify(altTextList)}`);
      return altTextList;
    } catch (error) {
      this.log.logger.error(`Error fetching descriptions, ${error}`);
      return '';
    }
  }

  /**
   * Generates alt text for an image.
   *
   * @param {Object} imageObject - The object containing the image information.
   * @return {Array} The list of alt texts generated for the images.
   */
  static async describeImage(imageObject) {
    try {
      ReplicateImageDescriber.log.logger.debug(
        'Generating imageFileObjectArray...',
      );
      const imageUrl = imageObject.imagesSource[0];
      ReplicateImageDescriber.log.logger.debug(
        `Generating imageFileObjectArray for ${imageUrl}`,
      );
      const imageFileObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imageObject);
      ReplicateImageDescriber.log.logger.debug(
        'Generating imageFileObjectArray... Done.',
      );
      const { dataURL } = imageFileObjectArray;
      const modelOwner = 'rmokady';
      const modelName = 'clip_prefix_caption';
      const modelLatestVersion = '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8';

      ReplicateImageDescriber.log.logger.info('Generating alt text...');
      const output = await ReplicateImageDescriber.replicate.run(
        `${modelOwner}/${modelName}:${modelLatestVersion}`,
        {
          input: {
            image: dataURL,
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
