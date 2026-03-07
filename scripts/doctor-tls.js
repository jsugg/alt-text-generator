#!/usr/bin/env node
/* eslint-disable no-console, no-continue, no-restricted-syntax */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const tls = require('tls');
const { execFileSync } = require('child_process');
const { X509Certificate } = require('crypto');

const DEFAULT_BUNDLE_FILE = 'certs/outbound-extra-ca.pem';
const DEFAULT_ENV_FILE = '.env.test';
const TLS_ISSUER_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const parseArgs = (argv) => {
  const args = {
    bundleFile: DEFAULT_BUNDLE_FILE,
    envFile: DEFAULT_ENV_FILE,
    fix: false,
    writeEnv: false,
    targetUrl: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--fix') {
      args.fix = true;
      continue;
    }

    if (arg === '--write-env') {
      args.writeEnv = true;
      continue;
    }

    if (arg === '--bundle-file') {
      i += 1;
      args.bundleFile = argv[i];
      continue;
    }

    if (arg === '--env-file') {
      i += 1;
      args.envFile = argv[i];
      continue;
    }

    if (!args.targetUrl) {
      args.targetUrl = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.targetUrl) {
    throw new Error('Usage: npm run doctor:tls -- <url> [--fix] [--write-env] [--bundle-file path] [--env-file path]');
  }

  return args;
};

const resolveFile = (filePath) => (
  path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath)
);

const rawToPem = (rawBuffer) => {
  const base64 = rawBuffer.toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
};

const splitPemCertificates = (pemText) => (
  pemText.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\n?/g) ?? []
);

const getCommonName = (subject) => {
  if (!subject) {
    return undefined;
  }

  if (typeof subject === 'string') {
    const match = subject.match(/CN\s*=\s*([^,]+)/);
    return match ? match[1].trim() : undefined;
  }

  return subject.CN;
};

const getFingerprint = (pemText) => new X509Certificate(pemText).fingerprint256;

const matchesExpectedCertificate = (pemText, expectedCertificate) => {
  const certificate = new X509Certificate(pemText);
  if (expectedCertificate.fingerprint256
    && certificate.fingerprint256 === expectedCertificate.fingerprint256) {
    return true;
  }

  const subjectCommonName = getCommonName(certificate.subject);
  const expectedCommonName = getCommonName(expectedCertificate.subject);
  return subjectCommonName && expectedCommonName && subjectCommonName === expectedCommonName;
};

const readBundleIfPresent = (bundleFile) => {
  const resolvedBundleFile = resolveFile(bundleFile);
  if (!fs.existsSync(resolvedBundleFile)) {
    return '';
  }

  return fs.readFileSync(resolvedBundleFile, 'utf8');
};

const appendCertificateToBundle = (bundleFile, pemText) => {
  const resolvedBundleFile = resolveFile(bundleFile);
  const existing = readBundleIfPresent(resolvedBundleFile);
  const existingFingerprints = new Set(
    splitPemCertificates(existing).map((certificate) => getFingerprint(certificate)),
  );
  const fingerprint = getFingerprint(pemText);

  if (existingFingerprints.has(fingerprint)) {
    return resolvedBundleFile;
  }

  fs.mkdirSync(path.dirname(resolvedBundleFile), { recursive: true });
  fs.appendFileSync(
    resolvedBundleFile,
    `${existing && !existing.endsWith('\n') ? '\n' : ''}${pemText}`,
    'utf8',
  );

  return resolvedBundleFile;
};

const updateEnvFile = (envFile, key, value) => {
  const resolvedEnvFile = resolveFile(envFile);
  const nextLine = `${key}=${value}`;
  const existing = fs.existsSync(resolvedEnvFile)
    ? fs.readFileSync(resolvedEnvFile, 'utf8')
    : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  let replaced = false;

  const updatedLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return nextLine;
    }

    return line;
  });

  if (!replaced) {
    updatedLines.push(nextLine);
  }

  fs.writeFileSync(
    resolvedEnvFile,
    `${updatedLines.filter((line, index, source) => (
      index < source.length - 1 || line.length > 0
    )).join(os.EOL)}${os.EOL}`,
    'utf8',
  );

  return resolvedEnvFile;
};

const probeUrl = (targetUrl, bundleFile) => new Promise((resolve) => {
  const url = new URL(targetUrl);
  const request = https.get(url, {
    ca: bundleFile ? fs.readFileSync(resolveFile(bundleFile), 'utf8') : undefined,
  }, (response) => {
    response.resume();
    response.on('end', () => {
      resolve({ ok: true, statusCode: response.statusCode });
    });
  });

  request.on('error', (error) => {
    resolve({ ok: false, error });
  });
});

const inspectCertificateChain = (targetUrl) => new Promise((resolve, reject) => {
  const url = new URL(targetUrl);
  const socket = tls.connect({
    host: url.hostname,
    port: Number(url.port) || 443,
    rejectUnauthorized: false,
    servername: url.hostname,
  });

  socket.once('secureConnect', () => {
    try {
      const chain = [];
      const seenFingerprints = new Set();
      let certificate = socket.getPeerCertificate(true);

      while (certificate && certificate.raw) {
        const pemText = rawToPem(certificate.raw);
        const fingerprint = certificate.fingerprint256;
        if (seenFingerprints.has(fingerprint)) {
          break;
        }

        seenFingerprints.add(fingerprint);
        chain.push({
          fingerprint256: fingerprint,
          issuer: certificate.issuer,
          pemText,
          subject: certificate.subject,
        });

        if (!certificate.issuerCertificate
          || certificate.issuerCertificate.fingerprint256 === fingerprint) {
          break;
        }

        certificate = certificate.issuerCertificate;
      }

      resolve(chain);
    } catch (error) {
      reject(error);
    } finally {
      socket.end();
    }
  });

  socket.once('error', reject);
});

const loadCertificatesFromPemText = (pemText, expectedCertificate) => (
  splitPemCertificates(pemText).find((certificate) => (
    matchesExpectedCertificate(certificate, expectedCertificate)
  ))
);

const findCertificateOnMacOS = (expectedCertificate) => {
  const commonName = getCommonName(expectedCertificate.subject);
  if (!commonName) {
    return undefined;
  }

  const keychains = [
    '/System/Library/Keychains/SystemRootCertificates.keychain',
    '/Library/Keychains/System.keychain',
    path.join(os.homedir(), 'Library/Keychains/login.keychain-db'),
  ];

  for (const keychain of keychains) {
    try {
      const pemText = execFileSync(
        'security',
        ['find-certificate', '-a', '-c', commonName, '-p', keychain],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const match = loadCertificatesFromPemText(pemText, expectedCertificate);
      if (match) {
        return match;
      }
    } catch {
      // Continue through other keychains.
    }
  }

  return undefined;
};

const findCertificateOnLinux = (expectedCertificate) => {
  const bundleCandidates = [
    '/etc/ssl/cert.pem',
    '/etc/ssl/certs/ca-certificates.crt',
    '/etc/ssl/ca-bundle.pem',
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
  ];

  for (const bundlePath of bundleCandidates) {
    if (!fs.existsSync(bundlePath)) {
      continue;
    }

    const pemText = fs.readFileSync(bundlePath, 'utf8');
    const match = loadCertificatesFromPemText(pemText, expectedCertificate);
    if (match) {
      return match;
    }
  }

  return undefined;
};

const derToPem = (base64Der) => rawToPem(Buffer.from(base64Der, 'base64'));

const findCertificateOnWindows = (expectedCertificate) => {
  const commonName = getCommonName(expectedCertificate.subject);
  if (!commonName) {
    return undefined;
  }

  const script = [
    '$cert = Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root',
    `| Where-Object { $_.Subject -like '*CN=${commonName}*' }`,
    '| Select-Object -First 1;',
    'if ($cert) { [Convert]::ToBase64String($cert.RawData) }',
  ].join(' ');

  try {
    const base64Der = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!base64Der) {
      return undefined;
    }

    const pemText = derToPem(base64Der);
    return matchesExpectedCertificate(pemText, expectedCertificate) ? pemText : undefined;
  } catch {
    return undefined;
  }
};

const findCertificateInSystemStore = (expectedCertificate) => {
  switch (process.platform) {
    case 'darwin':
      return findCertificateOnMacOS(expectedCertificate);
    case 'linux':
      return findCertificateOnLinux(expectedCertificate);
    case 'win32':
      return findCertificateOnWindows(expectedCertificate);
    default:
      return undefined;
  }
};

const printChain = (chain) => {
  console.log('Observed certificate chain:');
  chain.forEach((certificate, index) => {
    console.log(`  ${index + 1}. subject=${getCommonName(certificate.subject) || certificate.subject.CN || 'unknown'} issuer=${getCommonName(certificate.issuer) || certificate.issuer.CN || 'unknown'}`);
  });
};

const selectTrustAnchorCandidate = (chain) => {
  const lastCertificate = chain[chain.length - 1];
  if (!lastCertificate) {
    return undefined;
  }

  const subjectCommonName = getCommonName(lastCertificate.subject);
  const issuerCommonName = getCommonName(lastCertificate.issuer);

  if (subjectCommonName && issuerCommonName && subjectCommonName !== issuerCommonName) {
    return {
      issuer: lastCertificate.issuer,
      subject: {
        CN: issuerCommonName,
      },
    };
  }

  return lastCertificate;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const initialProbe = await probeUrl(args.targetUrl);

  if (initialProbe.ok) {
    console.log(`TLS probe succeeded: ${args.targetUrl} -> HTTP ${initialProbe.statusCode}`);
    return;
  }

  console.log(`TLS probe failed: ${initialProbe.error.code || initialProbe.error.message}`);

  if (!TLS_ISSUER_ERRORS.has(initialProbe.error.code)) {
    throw initialProbe.error;
  }

  const chain = await inspectCertificateChain(args.targetUrl);
  printChain(chain);

  const rootCandidate = selectTrustAnchorCandidate(chain);
  if (!rootCandidate) {
    throw new Error('Could not inspect the remote certificate chain.');
  }

  console.log(`Attempting to locate a trust anchor for ${getCommonName(rootCandidate.subject) || 'unknown root'} in the local system trust store.`);
  const pemText = findCertificateInSystemStore(rootCandidate);

  if (!pemText) {
    throw new Error(
      `Could not find a matching certificate for ${getCommonName(rootCandidate.subject) || 'the target issuer'} in the local system trust store. Configure OUTBOUND_CA_BUNDLE_FILE manually.`,
    );
  }

  console.log('Matching certificate found in the local system trust source.');

  if (!args.fix) {
    console.log('Run again with --fix to write an app-local CA bundle.');
    return;
  }

  const bundleFile = appendCertificateToBundle(args.bundleFile, pemText);
  console.log(`Wrote/updated supplemental CA bundle: ${bundleFile}`);

  if (args.writeEnv) {
    const envFile = updateEnvFile(args.envFile, 'OUTBOUND_CA_BUNDLE_FILE', bundleFile);
    console.log(`Updated env file: ${envFile}`);
  }

  const retryProbe = await probeUrl(args.targetUrl, bundleFile);
  if (!retryProbe.ok) {
    throw retryProbe.error;
  }

  console.log(`Retry succeeded: ${args.targetUrl} -> HTTP ${retryProbe.statusCode}`);
  console.log('Suggested startup command:');
  console.log(`  ENV_FILE=${args.envFile} node src/app.js`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
