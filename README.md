<div align="center">
    <img src="https://raw.githubusercontent.com/jsugg/alt-text-generator/main/.github/assets/alt-text-generator.png" width="1000">
</div>

# Alt-Text 4 All
---
![GitHub license](https://img.shields.io/github/license/jsugg/alt-text-generator)
![GitHub issues](https://img.shields.io/github/issues/jsugg/alt-text-generator)
![GitHub stars](https://img.shields.io/github/stars/jsugg/alt-text-generator)
![GitHub forks](https://img.shields.io/github/forks/jsugg/alt-text-generator)
---
## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [API Endpoints](#api-endpoints)
- [Contributing](#contributing)
- [License](#license)
---
## Overview
The AI-Driven Alt-Text Generator is a web service that automates the generation of alternative text for images on websites. It utilizes AI models to provide descriptive text for images, enhancing web accessibility. You can check a demo running [here](https://wcag.qcraft.dev)

## Features
- **Image Scraper**: Extracts image URLs from a given website.
- **AI-Generated Descriptions**: Provides alternative text for images using AI models.
---
## Installation
Clone the repository and navigate to the project directory. Install the required packages and start the server.

```bash
git clone https://github.com/jsugg/alt-text-generator.git
cd alt-text-generator
npm install
npm run dev
```
---
## Usage
### API Endpoints
#### Swagger Documentation
For detailed API documentation, visit `/api-docs` Swagger documentation.

#### Images
GET `/api/scrapper/images` or `/api/v1/scrapper/images`
- **Summary**: Returns the list of images found on a website.
- **Parameters**:
  - `url`: URLEncoded address of the website.
- **Response**: `200 OK` with JSON containing image URLs.
-------
#### Descriptions
GET `/api/accessibility/description` or `/api/v1/accessibility/description`
- **Summary**: Returns a description for a given image.
- **Parameters**:
  - `image_source`: URLEncoded address of the image.
  - `model`: AI model used ('clip' is currently available).
- **Response**: `200 OK` with JSON containing image description.
---
## Contributing
Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) to get started.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
