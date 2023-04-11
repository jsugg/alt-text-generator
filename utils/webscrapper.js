"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const url = require("url");

class WebScrapper {
  static isImage(imageUrl) {
    const imageExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".bmp",
      ".webp",
      ".svg",
    ];
    return imageExtensions.some((ext) =>
      imageUrl.toLowerCase().split("?")[0].endsWith(ext)
    );
  }

  static async fetchHtml(targetUrl) {
    try {
      const response = await axios.get(targetUrl, {
        headers: {
          Origin: targetUrl,
        },
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching the website:", error);
    }
    return null;
  }

  static extractImageSources(html, targetUrl) {
    const $ = cheerio.load(html);
    const images = [];
    const possibleAttributes = [
      "data-src",
      "data-original-src",
      "data-lazy-src",
      "data-srcset",
      "src",
    ];

    $("img").each((index, img) => {
      const imgAttributes = $(img)[0].attribs;
      let src;

      for (const attr of possibleAttributes) {
        const candidateSrc = imgAttributes[attr];
        if (candidateSrc && WebScrapper.isImage(candidateSrc)) {
          src = candidateSrc.split("?")[0];
          break;
        }
      }

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
        src = url.resolve(targetUrl, src);
        images.push(src);
      }
    });

    return { imageSources: images };
  }

  static async getImages(targetUrl) {
    const html = await WebScrapper.fetchHtml(targetUrl);
    if (!html) return null;
    const imageSources = WebScrapper.extractImageSources(html, targetUrl);
    console.log("Images:", imageSources.imageSources);
    return imageSources;
  }
}

module.exports = WebScrapper;

// Path: utils/scraper.js
