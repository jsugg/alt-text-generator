const axios = require('axios');
const cheerio = require('cheerio');
const url = require('url');

class WebScrapper {

    static isImage(url) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
        return imageExtensions.some(ext => url.toLowerCase().split('?')[0].endsWith(ext));
    }

    static async getImages(targetUrl) {
        try {
          // Fetch the HTML content of the website using Axios
          const response = await axios.get(targetUrl);
      
          // Parse the HTML using Cheerio
          const $ = cheerio.load(response.data);
      
          // Extract the src attribute of all img elements
          const images = [];
          const possibleAttributes = [
            'data-src',
            'data-original-src',
            'data-lazy-src',
            'data-srcset',
            'src'
          ];

          $('img').each((index, img) => {
            const imgAttributes = $(img)[0].attribs;
            //const imgAttributes = $(img).attribs;
            let src;

            // First, try the common attributes
            for (const attr of possibleAttributes) {
              const candidateSrc = imgAttributes[attr];
              if (candidateSrc && WebScrapper.isImage(candidateSrc)) {
                src = candidateSrc.split('?')[0];
                break;
              }
            }

            // If not found, search the rest of the attributes
            if (!src) {
              for (const attr in imgAttributes) {
                if (possibleAttributes.includes(attr)) continue;

                const candidateSrc = imgAttributes[attr];
                if (candidateSrc && WebScrapper.isImage(candidateSrc)) {
                  src = candidateSrc;
                  break;
                }
              }
            }

            if (src) {
              // Resolve relative URLs to absolute URLs
              src = url.resolve(targetUrl, src);
              images.push(src);
            }
          });

          // Log the images array
          console.log('Images:', images);

          // Return the images array
          return images;

        } catch (error) {
          console.error('Error fetching the website:', error);
        }
    }
}

module.exports = WebScrapper