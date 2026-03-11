const fs = require('node:fs');

/**
 * Reads and parses a Postman collection JSON file.
 *
 * @param {string} collectionPath
 * @returns {object}
 */
function readCollection(collectionPath) {
  return JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
}

/**
 * Returns all request items in a collection, including nested folders.
 *
 * @param {object} collection
 * @returns {{ item: object, topLevelFolderName: string }[]}
 */
function listRequestItems(collection) {
  const requestItems = [];

  const visit = (item, topLevelFolderName) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    if (item.request && typeof item.name === 'string') {
      requestItems.push({ item, topLevelFolderName });
    }

    if (Array.isArray(item.item)) {
      item.item.forEach((child) => visit(child, topLevelFolderName));
    }
  };

  (collection.item ?? []).forEach((folder) => {
    if (!folder || typeof folder.name !== 'string') {
      return;
    }

    visit(folder, folder.name);
  });

  return requestItems;
}

/**
 * Returns true when the request item includes a numeric X-Expected-Status-Code header.
 *
 * @param {object} item
 * @returns {boolean}
 */
function hasExpectedStatusCodeHeader(item) {
  return Boolean((item?.request?.header ?? []).some((header) => (
    header?.key === 'X-Expected-Status-Code'
      && /^\d+$/u.test(String(header.value ?? '').trim())
  )));
}

/**
 * Returns true when the request item includes an exact status assertion in its own tests.
 *
 * @param {object} item
 * @returns {boolean}
 */
function hasExactStatusAssertion(item) {
  const exactStatusPattern = /pm\.response\.to\.have\.status\(\s*\d+\s*\)|pm\.expect\(pm\.response\.code[\s\S]*?\)\.to\.(?:eql|equal)\(/;
  const events = Array.isArray(item?.event) ? item.event : [];

  return events.some((event) => {
    if (event?.listen !== 'test' || !Array.isArray(event?.script?.exec)) {
      return false;
    }

    return exactStatusPattern.test(event.script.exec.join('\n'));
  });
}

/**
 * Returns true when the request item includes a specific status contract.
 *
 * @param {object} item
 * @returns {boolean}
 */
function hasSpecificStatusExpectation(item) {
  return hasExpectedStatusCodeHeader(item) || hasExactStatusAssertion(item);
}

/**
 * Throws when one or more requests are missing a specific status expectation.
 *
 * @param {object} collection
 */
function assertRequestItemsHaveSpecificStatusExpectations(collection) {
  const missingAssertions = listRequestItems(collection)
    .filter(({ item }) => !hasSpecificStatusExpectation(item))
    .map(({ item, topLevelFolderName }) => `${topLevelFolderName} > ${item.name}`);

  if (missingAssertions.length === 0) {
    return;
  }

  throw new Error(
    `Missing specific status expectations for Postman requests: ${missingAssertions.join(', ')}`,
  );
}

/**
 * Returns the top-level folder names in a Postman collection.
 *
 * @param {object} collection
 * @returns {string[]}
 */
function listTopLevelFolderNames(collection) {
  return (collection.item ?? [])
    .map((item) => item.name)
    .filter((name) => typeof name === 'string' && name.length > 0);
}

/**
 * Throws when one or more requested folders do not exist in the collection.
 *
 * @param {string[]} availableFolders
 * @param {string[]} requiredFolders
 * @param {string} context
 */
function assertTopLevelFoldersExist(availableFolders, requiredFolders, context) {
  const missingFolders = requiredFolders.filter((folder) => !availableFolders.includes(folder));

  if (missingFolders.length === 0) {
    return;
  }

  throw new Error(
    `Missing Postman folders for ${context}: ${missingFolders.join(', ')}. `
      + `Available folders: ${availableFolders.join(', ')}`,
  );
}

/**
 * Builds a map of collection item ids to their top-level folder name.
 *
 * @param {object} collection
 * @returns {Map<string, string>}
 */
function buildItemFolderMap(collection) {
  const itemFolderMap = new Map();

  const visit = (item, topLevelFolderName) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    if (typeof item.id === 'string') {
      itemFolderMap.set(item.id, topLevelFolderName);
    }

    if (typeof item.name === 'string' && item.request) {
      itemFolderMap.set(item.name, topLevelFolderName);
    }

    if (Array.isArray(item.item)) {
      item.item.forEach((child) => {
        visit(child, topLevelFolderName);
      });
    }
  };

  (collection.item ?? []).forEach((folder) => {
    if (!folder || typeof folder.name !== 'string') {
      return;
    }

    visit(folder, folder.name);
  });

  return itemFolderMap;
}

module.exports = {
  assertRequestItemsHaveSpecificStatusExpectations,
  assertTopLevelFoldersExist,
  buildItemFolderMap,
  hasExactStatusAssertion,
  hasExpectedStatusCodeHeader,
  hasSpecificStatusExpectation,
  listTopLevelFolderNames,
  listRequestItems,
  readCollection,
};
