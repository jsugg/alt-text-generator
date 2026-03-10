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
  assertTopLevelFoldersExist,
  buildItemFolderMap,
  listTopLevelFolderNames,
  readCollection,
};
