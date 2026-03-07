<div align="center">
    <img src="https://raw.githubusercontent.com/jsugg/alt-text-generator/main/.github/assets/alt-text-generator.png" width="1000">
</div>

# Alt-Text 4 All

![GitHub license](https://img.shields.io/github/license/jsugg/alt-text-generator)
![GitHub issues](https://img.shields.io/github/issues/jsugg/alt-text-generator)
![GitHub stars](https://img.shields.io/github/stars/jsugg/alt-text-generator)
![GitHub forks](https://img.shields.io/github/forks/jsugg/alt-text-generator)

## Overview

Alt-Text 4 All is an HTTPS-first API that scrapes website images and generates AI-powered alt text to improve accessibility workflows.

The service exposes these primary capabilities:

- discover image URLs on a target page
- generate alt text for a specific image with the `clip` model
- generate alt text for all images on a page while preserving duplicate entries

## Features

- Website image scraping with relative URL resolution
- AI-generated descriptions for image URLs
- HTTPS-first local runtime with automatic HTTP -> HTTPS redirect
- Swagger UI for interactive API exploration
- Lint and test automation in CI

## Requirements

- Node.js 20.x recommended. CI runs on Node 20, while [package.json](./package.json) declares `>=18`.
- npm 10+
- A Replicate API token (required to boot; must be valid for real alt-text generation)

## Quick Start

```bash
git clone https://github.com/jsugg/alt-text-generator.git
cd alt-text-generator
cp .env.example .env
# edit .env and set REPLICATE_API_TOKEN
npm install
npm run dev
```

Local defaults:

- HTTPS listens on `https://localhost:8443`
- HTTP listens on `http://localhost:8080` and redirects to HTTPS
- Development TLS uses `TLS_KEY` / `TLS_CERT` if provided, then local `certs/localhost*.pem` if present, and otherwise auto-generates a localhost self-signed certificate in-process

Smoke checks:

```bash
curl -sk https://localhost:8443/api/health
curl -sk https://localhost:8443/api-docs/
```

Note: `-k` skips TLS certificate verification. It is used here because development HTTPS may be self-signed.
Do not use `-k` for production traffic.

## Runtime Essentials

Required for real descriptions:

- `REPLICATE_API_TOKEN` (required at startup; a dummy value is OK for stubbed-provider validation)

Common local settings:

- `PORT` and `TLS_PORT`
- `TLS_KEY` and `TLS_CERT`
  - Optional in local development
  - Required in production
  - Can be file paths, inline PEM values, or base64-encoded PEM values
- `OUTBOUND_CA_BUNDLE_FILE`
  - Optional app-managed supplemental PEM bundle for outbound HTTPS trust
  - Use `npm run doctor:tls -- https://example.com --fix --write-env --env-file .env.test` when a target works in `curl` but fails in Node/app scraping

Advanced runtime settings such as worker count, scraper timeouts, rate limits, logging, Swagger URLs, and stubbed provider endpoints are documented in [DEVELOPMENT.md](./DEVELOPMENT.md).

## API Endpoints

### Swagger Documentation

Interactive documentation: `/api-docs`

### Images

GET `/api/scraper/images` or `/api/v1/scraper/images`

- Summary: returns image URLs found on a website
- Query params:
  - `url`: URL-encoded address of the target website

Example:

```bash
curl -sk "https://localhost:8443/api/scraper/images?url=https%3A%2F%2Fdeveloper.chrome.com%2F"
```

### Descriptions

GET `/api/accessibility/description` or `/api/v1/accessibility/description`

- Summary: returns an alt-text description for a given image
- Query params:
  - `image_source`: URL-encoded address of the image
  - `model`: AI model identifier, currently `clip`

Example:

```bash
curl -sk "https://localhost:8443/api/accessibility/description?image_source=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F1x%2Fgooglelogo_color_272x92dp.png&model=clip"
```

GET `/api/accessibility/descriptions` or `/api/v1/accessibility/descriptions`

- Summary: scrapes a page and returns descriptions for its images
- Query params:
  - `url`: URL-encoded address of the target website
  - `model`: AI model identifier, currently `clip`
- Notes:
  - preserves duplicate image entries in page order
  - reuses one prediction per unique normalized image URL per request

Example:

```bash
curl -sk "https://localhost:8443/api/accessibility/descriptions?url=https%3A%2F%2Fdeveloper.chrome.com%2F&model=clip"
```

## Development

Use the development guide for:

- complete environment-variable reference
- TLS and outbound CA troubleshooting
- lint, test, and live validation commands
- real external-integration validation with Replicate

See [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
