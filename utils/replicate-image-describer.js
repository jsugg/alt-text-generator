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

  // Convert an image URL to a File object
  static async urlToDataURL(url) {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url);
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
  
    return { dataURL, options };
  }
  

  // Convert an object with image URLs to an array of File objects
  static async imagesObjectToArray(imagesObject) {
    const imageSources = JSON.parse(imagesObject)["imagesSource"];

    const imageFilesObject = await Promise.all(imageSources.map(ReplicateImageDescriber.urlToDataURL));
    return imageFilesObject;
  }

  static async describeImages(imagesObject) {
    try {
      const imageFilesObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imagesObject);
      //const { dataURL, options } = imageFilesObjectArray
      const dataURLArray = imageFilesObjectArray.map( obj => obj.dataURL);
      const modelOwner = 'rmokady';
      const modelName = 'clip_prefix_caption';
      //const model = await ReplicateImageDescriber.replicate.models.get(modelOwner, modelName);
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

  static async describeImage(imageObject) {
    try {
      const imageUrl = JSON.parse(imageObject)["imagesSource"][0];
      const imageFileObjectArray = await ReplicateImageDescriber.imagesObjectToArray(imageObject);
      const dataURLArray = imageFileObjectArray.map( obj => obj.dataURL);
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
        console.log(`Run output: ${output}`);
        ReplicateImageDescriber.altTextList.push({ description: output, imageUrl: imageUrl });
      }

      return ReplicateImageDescriber.altTextList;
    } catch (error) {
      console.error(`Error fetching descriptions, ${error}`);
    }
  }
}

ReplicateImageDescriber.setUp({ userAgent: 'alt-text-generator/1.0.0' });

module.exports = ReplicateImageDescriber;