require("dotenv").config();
const Replicate = require("replicate");
const axios = require('axios');

class ReplicateImageDescriber {
    static replicate;
    static delayBetweenRequests = 10;
    static altTextList = [];
    static log;

    static use({ logger } = {}) {
      logger? ReplicateImageDescriber.log = logger : ReplicateImageDescriber.log = log;
    }

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
    static async urlToDataURL(url) {
      const fetch = (await import("node-fetch")).default;
      ReplicateImageDescriber.log.logger.info(`Converting image URL to dataURL... Fetching image`);
      const response = await fetch(url);
      ReplicateImageDescriber.log.logger.info(`Converting image URL to dataURL... Fetching image... Done.`);
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type");
      const fileExtension = contentType.split("/")[1];
      const base64Data = Buffer.from(buffer).toString("base64");
      const dataURL = `data:${contentType};base64,${base64Data}.${fileExtension}`;
      const dataURLWithoutPrefix = dataURL.slice(dataURL.indexOf(",") + 1);
      const decodedData = Buffer.from(dataURLWithoutPrefix, "base64");
      const contentLength = decodedData.byteLength;
      const headers = { "Content-Length": contentLength };
      const options = { headers };
    
      ReplicateImageDescriber.log.logger.info(`Converting image URL to dataURL... Done.`);
      return { dataURL, options };
    }
    

    // Convert an object with image URLs to an array of File objects
    static async imagesObjectToArray(imagesObject) {
      ReplicateImageDescriber.log.logger.debug(`Converting image URLs to dataURLs... imagesObject: ${imagesObject}...`);
      //const imageSources = JSON.parse(imagesObject)["imagesSource"];
      const imageSources = imagesObject.imagesSource[0];
      ReplicateImageDescriber.log.logger.debug(`Converting image URLs to dataURLs... imageSources: ${imageSources}...`);

      ReplicateImageDescriber.log.logger.debug(`Converting image URLs to dataURLs...`);
      const imageFilesObject = await ReplicateImageDescriber.urlToDataURL(imageSources);

      ReplicateImageDescriber.log.logger.debug(`Converting image URLs to dataURLs... Done.`);
      return imageFilesObject;
    }

    static async describeImages(imagesObject) {
      try {
        ReplicateImageDescriber.log.logger.debug(`Generating imageFileObjectArray for ${imagesObject}`);
        const imageFilesObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imagesObject);
        const dataURLArray = imageFilesObjectArray.map( obj => obj.dataURL);
        const modelOwner = 'rmokady';
        const modelName = 'clip_prefix_caption';
        const modelLatestVersion = '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8';

        ReplicateImageDescriber.log.logger.debug(`Generating alt text for ${imageFilesObjectArray.length} images. Model: ${modelOwner}/${modelName}:${modelLatestVersion}. `);
        for (const img of dataURLArray) {
          ReplicateImageDescriber.log.logger.debug(`Generating alt text for image: ${img}...`)
          const output = await ReplicateImageDescriber.replicate.run(
            `${modelOwner}/${modelName}:${modelLatestVersion}`,
            {
              input: {
                image: img,
              },
            }
          );
          ReplicateImageDescriber.log.logger.debug(`Generating alt text for image: ${img}... Done. Alt text: ${output}`);

          ReplicateImageDescriber.altTextList.push({ image: img, description: output });

          await ReplicateImageDescriber.delay(ReplicateImageDescriber.delayBetweenRequests);
        }

        ReplicateImageDescriber.log.logger.info(`Alt text generated for ${imageFilesObjectArray.length} images. altTextList: ${ReplicateImageDescriber.altTextList}`);
        return ReplicateImageDescriber.altTextList;
      } catch (error) {
        console.error(`Error fetching descriptions, ${error}`);
      }
    }

    static async describeImage(imageObject) {
      try {
        ReplicateImageDescriber.log.logger.debug(`Generating imageFileObjectArray...`);
        const imageUrl = imageObject.imagesSource[0];
        ReplicateImageDescriber.log.logger.debug(`Generating imageFileObjectArray for ${imageUrl}`);
        const imageFileObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imageObject);
        ReplicateImageDescriber.log.logger.debug(`Generating imageFileObjectArray... Done.`)
        const dataURL = imageFileObjectArray.dataURL;
        const modelOwner = 'rmokady';
        const modelName = 'clip_prefix_caption';
        const modelLatestVersion = '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8';

        ReplicateImageDescriber.log.logger.info(`Generating alt text...`);
          const output = await ReplicateImageDescriber.replicate.run(
            `${modelOwner}/${modelName}:${modelLatestVersion}`,
            {
              input: {
                image: dataURL,
              },
            }
          );
          ReplicateImageDescriber.altTextList.push({ description: output, imageUrl: imageUrl });
        ReplicateImageDescriber.log.logger.debug(`Alt text generated for ${imageUrl}`);
        return ReplicateImageDescriber.altTextList;
      } catch (error) {
        ReplicateImageDescriber.log.logger.info(`Error fetching descriptions, ${error}`);
      }
    }
  }

  ReplicateImageDescriber.setUp({ userAgent: 'alt-text-generator/1.0.0' });

  module.exports = ReplicateImageDescriber;