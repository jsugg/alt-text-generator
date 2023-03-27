require("dotenv").config();
const axios = require('axios');

class AzureImageDescriber {

    static azureComputerVisionApiKey = process.env.ACV_API_KEY || '0708f80b58484dc99264db1c22d98c60';
    static azureComputerVisionApiEndpoint = process.env.ACV_API_ENDPOINT || 'https://eastus.api.cognitive.microsoft.com/vision/v3.2/describe';
    static azureComputerVisionSubscriptionKey = process.env.ACV_SUBSCRIPTION_KEY || '6bdabd22-123c-44ab-9519-7231ddfb9481';
    static delayBetweenRequests = 3000;
    static altTextList = [];

    static delay(interval) {
        return new Promise(resolve => setTimeout(resolve, interval));
    }

    static async describeImages(images) {
        try {
            images = JSON.parse(images).imageSources;
        for (const img in images) {
            const imageRequest = { "url": images[img]};
            const response = await axios.post(`${AzureImageDescriber.azureComputerVisionApiEndpoint}?maxCandidates=4&language=pt&model-version=latest`, {
                headers: {
                    'Host': 'eastus.api.cognitive.microsoft.com',
                    'Content-Type': 'application/json',
                    'Ocp-Apim-Subscription-Key': AzureImageDescriber.azureComputerVisionSubscriptionKey
                },
                body: imageRequest
            });
            //.then(async (response) => { await response.json() },
            //    (error) => { console.error(error) });

            const data = await response.json(); // await response.json();
        
            const captions = data.description.captions.map(caption => caption.text);
            const altText = captions.join(',');

            console.log(`Captions: [${typeof captions}] ${captions}`);
            
            AzureImageDescriber.altTextList.push({ imageUrl: images[img], altText });
            await AzureImageDescriber.delay(AzureImageDescriber.delayBetweenRequests);
        };

        return AzureImageDescriber.altTextList;
        } catch (error) {
            console.error(`Error fetching descriptions, ${error}`);
        }
        
    }
}

module.exports = AzureImageDescriber;
