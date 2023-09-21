require('dotenv').config();
const axios = require('axios');

/**
 * A class that provides a static method to describe images using the Azure Computer Vision API.
 * @class
 */
class AzureImageDescriber {
  /**
   * The Azure Computer Vision API key.
   * @type {string}
   * @static
   */
  static azureComputerVisionApiKey = process.env.ACV_API_KEY;

  /**
   * The Azure Computer Vision API endpoint.
   * @type {string}
   * @static
   */
  static azureComputerVisionApiEndpoint = process.env.ACV_API_ENDPOINT;

  /**
   * The Azure Computer Vision subscription key.
   * @type {string}
   * @static
   */
  static azureComputerVisionSubscriptionKey = process.env.ACV_SUBSCRIPTION_KEY;

  /**
   * The delay between requests to the Azure Computer Vision API.
   * @type {number}
   * @static
   */
  static delayBetweenRequests = 3000;

  /**
   * The list to store the alt text for each image.
   * @type {Array}
   * @static
   */
  static altTextList = [];

  /**
   * Delays the execution for a specified interval.
   * @param {number} interval - The delay interval in milliseconds.
   * @returns {Promise<number>} A promise that resolves after the specified interval.
   * @static
   */
  static delay(interval) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(interval), interval);
    });
  }

  /**
   * Describes the images using the Azure Computer Vision API.
   * @param {string} imagesParam - A JSON string containing the image sources.
   * @returns {Promise<Array>} A promise that resolves with an array of objects containing the image URL and its corresponding alt text.
   * @static
   */
  static async describeImages(imagesParam) {
    try {
      const parsedImages = JSON.parse(imagesParam).imageSources;
      const altTextList = [];

      await Promise.all(
        Object.keys(parsedImages).map(async (imgKey) => {
          if (Object.prototype.hasOwnProperty.call(parsedImages, imgKey)) {
            const img = parsedImages[imgKey];
            const imageRequest = { url: img };

            const response = await axios.post(
              `${AzureImageDescriber.azureComputerVisionApiEndpoint}?maxCandidates=4&language=pt&model-version=latest`,
              {
                headers: {
                  Host: 'eastus.api.cognitive.microsoft.com',
                  'Content-Type': 'application/json',
                  'Ocp-Apim-Subscription-Key':
                    AzureImageDescriber.azureComputerVisionSubscriptionKey,
                },
                body: imageRequest,
              },
            );

            const data = await response.json();
            const captions = data.description.captions.map((caption) => caption.text);
            const altText = captions.join(',');

            console.log(`Captions: [${typeof captions}] ${captions}`);

            altTextList.push({
              imageUrl: img,
              altText,
            });

            await AzureImageDescriber.delay(AzureImageDescriber.delayBetweenRequests);
          }
        }),
      );

      return altTextList;
    } catch (error) {
      console.error(`Error fetching descriptions, ${error}`);
      return [];
    }
  }
}

module.exports = AzureImageDescriber;
