require("dotenv").config();
const Replicate = require("replicate");
const axios = require('axios');

class ReplicateImageDescriber {
  static replicate;
  static delayBetweenRequests = 10;
  static altTextList = [];

  static setUp(options = {}) {
    options.auth = options.auth || process.env.REPLICATE_API_TOKEN;
    options.baseUrl = options.baseUrl || process.env.REPLICATE_API_ENDPOINT;
    options.userAgent = options.userAgent || process.env.REPLICATE_USER_AGENT;
    ReplicateImageDescriber.replicate = new Replicate(options);
  }

  static async pollEndpoint(url, interval) {
    const token = ReplicateImageDescriber.replicate.options.auth;
    const headers = {
        'Authorization': `Token ${token}`
    };
    while (true) {
      try {
        const response = await axios.get(url, { headers });
        if (response.status === 200) {
          // If the response is successful, return the data
          if (['succeeded', 'failed', 'canceled'].includes(JSON.parse(response.data).status))
            { return JSON.parse(response.data).status };
        } else if (response.status > 203) {
            return response.status;
        }

      } catch (error) {
        console.error(`Error polling endpoint: ${error}`);
      }
      // Wait for the specified interval before polling again
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  static delay(interval) {
    return new Promise((resolve) => setTimeout(resolve, interval));
  }

  // Converts image URL to dataUrl
  static async urlToDataURL(url, log) {
    log.logger.debug(`Importing node-fetch module`);
    const fetch = (await import("node-fetch")).default;
    log.logger.debug(`Fetching image: ${url}`);
    const response = await fetch(url);
    log.logger.debug(`Waiting for response.arrayBuffer()`);
    const buffer = await response.arrayBuffer();
    log.logger.debug(`Building dataURL and request headers`);
    const contentType = response.headers.get("content-type");
    const fileExtension = contentType.split("/")[1];
    const base64Data = Buffer.from(buffer).toString("base64");
    const dataURL = `data:${contentType};base64,${base64Data}.${fileExtension}`;
    const dataURLWithoutPrefix = dataURL.slice(dataURL.indexOf(",") + 1);
    const decodedData = Buffer.from(dataURLWithoutPrefix, "base64");
    const contentLength = decodedData.byteLength;
    const headers = { "Content-Length": contentLength };
    const options = { headers };

    log.logger.debug(`Returning dataURL and request headers`);
    return { dataURL, options };
  }
  

  // Convert image URLs to a dataURL Array
  static async imagesObjectToArray(imagesObject, log) {
    log.logger.debug(`Parsing JSON object: ${imagesObject}`);
    const imageSources = JSON.parse(imagesObject)["imagesSource"];

    log.logger.debug(`Asking urlToDataURL to fetch image and return dataURL`);
    const imageFilesObject = await Promise.all(imageSources.map( url => ReplicateImageDescriber.urlToDataURL(url, log)));
    log.logger.debug(`Returning image as dataURL: ${imageFilesObject}`);
    return imageFilesObject;
  }

  // Describe many images
  static async describeImages(imagesObject) {
    try {
      const imageFilesObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imagesObject);
      const dataURLArray = imageFilesObjectArray.map( obj => obj.dataURL);
      const modelOwner = 'rmokady';
      const modelName = 'clip_prefix_caption';
      const modelLatestVersion = '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8';

      for (const img of dataURLArray) {
        const output = await ReplicateImageDescriber.replicate.run(
          `${modelOwner}/${modelName}:${modelLatestVersion}`,
          {
            input: {
              image: img,
            },
          }
        );
        console.log(output);

        ReplicateImageDescriber.altTextList.push({ image: img, description: output });

        await ReplicateImageDescriber.delay(ReplicateImageDescriber.delayBetweenRequests);
      }

      return ReplicateImageDescriber.altTextList;
    } catch (error) {
      console.error(`Error fetching descriptions, ${error}`);
    }
  }

  // Describe a single image
  static async describeImage(imageObject, log) {
    try {
      log.logger.debug('Parsing imageObject');
      const imageUrl = JSON.parse(imageObject)["imagesSource"][0];
      log.logger.debug('Calling imagesObjectToArray');
      const imageFileObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imageObject, log);
      log.logger.debug('Mapping imageFileObjectArray to dataURLArray');
      const dataURLArray = imageFileObjectArray.map( obj => obj.dataURL);
      const modelOwner = 'rmokady';
      const modelName = 'clip_prefix_caption';
      const modelLatestVersion = '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8';

      log.logger.debug(`Stepping into description requests loop`);
      for (const img of dataURLArray) {
        log.logger.debug(`Asking model to describe ${imageUrl}`);
        const output = await ReplicateImageDescriber.replicate.run(
          `${modelOwner}/${modelName}:${modelLatestVersion}`,
          {
            input: {
              image: img,
            },
          }
        );
        log.logger.debug(`Model output: ${output}`);
        log.logger.debug(`Pushing output into altTextList array`)
        ReplicateImageDescriber.altTextList.push({ description: output, imageUrl: imageUrl });
      }

      log.logger.debug(`Returning altTextList array: ${ReplicateImageDescriber.altTextList}`);
      return ReplicateImageDescriber.altTextList;

    } catch (error) {
      log.logger.debug(`Error fetching descriptions, ${error}`);
      //console.error(`Error fetching descriptions, ${error}`);
    }
  }
}

ReplicateImageDescriber.setUp({ userAgent: 'alt-text-generator/1.0.0' });

module.exports = ReplicateImageDescriber;