/**
 * Static inventory of the assertions embedded in the Postman collection.
 *
 * Every request script is scanned for `pm.test(...)` blocks and the matcher
 * sites inside them, so the Jest migration can be checked for parity by id
 * rather than by raw totals. Scripts are masked first (string, template,
 * regex, and comment contents blanked out at identical offsets) so tokens that
 * merely appear inside literals are never counted and bracket matching is exact.
 */

const { declaresSkipRequest, getExpectedStatusCode } = require('../postman/collection-utils');

/** @typedef {import('../postman/collection-utils').CollectionItem} CollectionItem */
/** @typedef {import('../postman/collection-utils').CollectionEvent} CollectionEvent */
/** @typedef {import('../postman/collection-utils').PostmanCollection} PostmanCollection */

/** @typedef {'pm.expect' | 'pm.expect.fail' | 'pm.response.to'} MatcherKind */
/** @typedef {'prerequest' | 'test'} ScriptEvent */

/**
 * @typedef {object} MatcherSite
 * @property {string} id
 * @property {MatcherKind} kind
 * @property {number} line
 * @property {string} source
 */

/**
 * @typedef {object} PmTestBlock
 * @property {string} id
 * @property {string} name
 * @property {boolean} dynamicName
 * @property {ScriptEvent} event
 * @property {number} line
 * @property {MatcherSite[]} matchers
 */

/**
 * @typedef {object} ScriptInventory
 * @property {PmTestBlock[]} pmTests
 * @property {MatcherSite[]} unownedMatchers
 */

/**
 * @typedef {object} RequestInventory
 * @property {string} id
 * @property {string} name
 * @property {string} method
 * @property {string} url
 * @property {number | null} expectedStatus
 * @property {boolean} skippable
 * @property {PmTestBlock[]} pmTests
 * @property {MatcherSite[]} unownedMatchers
 */

/**
 * @typedef {object} FolderInventory
 * @property {string} name
 * @property {PmTestBlock[]} pmTests folder-level (and nested sub-folder) scripts
 * @property {MatcherSite[]} unownedMatchers
 * @property {RequestInventory[]} requests
 */

/**
 * @typedef {object} InventoryTotals
 * @property {number} folders
 * @property {number} requests
 * @property {number} pmTests
 * @property {number} pmExpectSites
 * @property {number} responseAssertionSites
 * @property {number} matcherSites
 */

/**
 * @typedef {object} CollectionInventory
 * @property {InventoryTotals} totals
 * @property {ScriptInventory} collectionScript
 * @property {FolderInventory[]} folders
 */

const COLLECTION_SCRIPT_ID = 'collection';
const SCRIPT_EVENTS = /** @type {const} */ (['prerequest', 'test']);

// Characters after which `/` starts a regex literal rather than a division.
const REGEX_PRECEDING_CHARS = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_PRECEDING_KEYWORDS = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw',
  'typeof', 'void', 'yield',
]);
const OPENING_BRACKETS = new Set(['(', '[', '{']);
const CLOSING_BRACKETS = new Set([')', ']', '}']);

// Order matters: `pm.expect.fail(` must win over the shorter `pm.expect(` prefix.
const MATCHER_PATTERNS = /** @type {{ kind: MatcherKind, pattern: RegExp }[]} */ ([
  { kind: 'pm.expect.fail', pattern: /\bpm\.expect\.fail\s*\(/gu },
  { kind: 'pm.expect', pattern: /\bpm\.expect\s*\(/gu },
  { kind: 'pm.response.to', pattern: /\bpm\.response\.to(?:\.[A-Za-z_$][\w$]*)+/gu },
]);
const PM_TEST_PATTERN = /\bpm\.test\s*\(/gu;

/**
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\$\{[^}]*\}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * @param {string} source
 * @param {number} index
 * @returns {string}
 */
function previousWord(source, index) {
  const match = source.slice(0, index).match(/([A-Za-z_$][\w$]*)\s*$/u);
  return match ? match[1] : '';
}

/**
 * Returns `source` with the contents of strings, template literal text,
 * regex literals, and comments replaced by spaces. Delimiters, newlines, and
 * offsets are preserved, so positions found in the mask index into `source`.
 *
 * @param {string} source
 * @returns {string}
 */
function maskLiterals(source) {
  const chars = [...source];
  /** @type {('code' | 'template')[]} */
  const modeStack = ['code'];
  /** @type {number[]} */
  const templateBraceDepths = [];
  let lastSignificant = '';
  let lastSignificantIndex = -1;
  let index = 0;

  /** @param {number} at */
  const blank = (at) => {
    if (chars[at] !== '\n') {
      chars[at] = ' ';
    }
  };

  /**
   * Blanks a quoted literal body and returns the index after its closing quote.
   *
   * @param {number} start index of the opening quote
   * @param {string} quote
   * @returns {number}
   */
  const skipQuoted = (start, quote) => {
    let cursor = start + 1;

    while (cursor < chars.length && chars[cursor] !== quote && chars[cursor] !== '\n') {
      if (chars[cursor] === '\\') {
        blank(cursor);
        cursor += 1;
      }
      blank(cursor);
      cursor += 1;
    }

    return cursor + 1;
  };

  /**
   * @param {number} start index of the opening slash
   * @returns {number}
   */
  const skipRegex = (start) => {
    let cursor = start + 1;
    let inClass = false;

    while (cursor < chars.length && chars[cursor] !== '\n') {
      const char = chars[cursor];

      if (char === '\\') {
        blank(cursor);
        cursor += 1;
      } else if (char === '[') {
        inClass = true;
      } else if (char === ']') {
        inClass = false;
      } else if (char === '/' && !inClass) {
        break;
      }

      blank(cursor);
      cursor += 1;
    }

    cursor += 1;
    while (cursor < chars.length && /[A-Za-z]/u.test(chars[cursor])) {
      cursor += 1;
    }

    return cursor;
  };

  while (index < chars.length) {
    const char = chars[index];
    const next = chars[index + 1];
    const mode = modeStack[modeStack.length - 1];

    if (mode === 'template') {
      if (char === '\\') {
        blank(index);
        blank(index + 1);
        index += 2;
      } else if (char === '`') {
        modeStack.pop();
        lastSignificant = '`';
        index += 1;
      } else if (char === '$' && next === '{') {
        modeStack.push('code');
        templateBraceDepths.push(0);
        lastSignificant = '{';
        index += 2;
      } else {
        blank(index);
        index += 1;
      }
    } else if (char === '}' && templateBraceDepths.at(-1) === 0) {
      templateBraceDepths.pop();
      modeStack.pop();
      lastSignificant = '}';
      index += 1;
    } else if (char === '/' && next === '/') {
      while (index < chars.length && chars[index] !== '\n') {
        blank(index);
        index += 1;
      }
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? chars.length : end + 2;
      while (index < stop) {
        blank(index);
        index += 1;
      }
    } else if (char === '\'' || char === '"') {
      index = skipQuoted(index, char);
      lastSignificant = char;
    } else if (char === '`') {
      modeStack.push('template');
      index += 1;
    } else if (
      char === '/'
      && (
        lastSignificant === ''
        // `i++ / 2` and `i-- / 2` end an operand, so their slash divides.
        || (
          REGEX_PRECEDING_CHARS.has(lastSignificant)
          && !(['+', '-'].includes(lastSignificant) && source[lastSignificantIndex - 1] === lastSignificant)
        )
        || REGEX_PRECEDING_KEYWORDS.has(previousWord(source, index))
      )
    ) {
      index = skipRegex(index);
      lastSignificant = '/';
    } else {
      if (templateBraceDepths.length > 0 && (char === '{' || char === '}')) {
        templateBraceDepths[templateBraceDepths.length - 1] += char === '{' ? 1 : -1;
      }

      if (!/\s/u.test(char)) {
        lastSignificant = char;
        lastSignificantIndex = index;
      }
      index += 1;
    }
  }

  return chars.join('');
}

/**
 * Finds the index of the bracket closing the one opened at `openIndex`.
 *
 * @param {string} masked
 * @param {number} openIndex
 * @returns {number}
 */
function findClosingBracket(masked, openIndex) {
  let depth = 0;

  for (let cursor = openIndex; cursor < masked.length; cursor += 1) {
    if (OPENING_BRACKETS.has(masked[cursor])) {
      depth += 1;
    } else if (CLOSING_BRACKETS.has(masked[cursor])) {
      depth -= 1;

      if (depth === 0) {
        return cursor;
      }
    }
  }

  throw new Error(`unbalanced bracket at offset ${openIndex}`);
}

/**
 * Returns the end offset of the statement starting at `start`: the first `;`
 * at the starting depth, or the bracket that closes the enclosing block.
 *
 * @param {string} masked
 * @param {number} start
 * @returns {number}
 */
function findStatementEnd(masked, start) {
  let depth = 0;

  for (let cursor = start; cursor < masked.length; cursor += 1) {
    const char = masked[cursor];

    if (OPENING_BRACKETS.has(char)) {
      depth += 1;
    } else if (CLOSING_BRACKETS.has(char)) {
      if (depth === 0) {
        return cursor;
      }
      depth -= 1;
    } else if (char === ';' && depth === 0) {
      return cursor;
    }
  }

  return masked.length;
}

/**
 * @param {string} source
 * @param {number} offset
 * @returns {number}
 */
function lineAt(source, offset) {
  let line = 1;

  for (let cursor = 0; cursor < offset; cursor += 1) {
    if (source[cursor] === '\n') {
      line += 1;
    }
  }

  return line;
}

/**
 * Reads the literal first argument of a `pm.test(` call.
 *
 * @param {string} source
 * @param {number} argumentsStart index just after the opening parenthesis
 * @returns {{ name: string, dynamicName: boolean }}
 */
function readTestName(source, argumentsStart) {
  const match = source.slice(argumentsStart).match(/^\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1(\s*\+)?/u);

  if (!match) {
    throw new Error(`pm.test at offset ${argumentsStart} has no literal name`);
  }

  return {
    name: match[2],
    // A concatenated name (`'status ' + code`) only records its literal prefix.
    dynamicName: Boolean(match[3]) || (match[1] === '`' && match[2].includes('${')),
  };
}

/**
 * Builds unique, readable ids from names, suffixing repeats with `~n`.
 *
 * @param {string} prefix
 * @returns {(name: string) => string}
 */
function createIdAllocator(prefix) {
  /** @type {Map<string, number>} */
  const seen = new Map();

  return (name) => {
    const slug = slugify(name) || 'unnamed';
    const count = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, count);

    return `${prefix}/${slug}${count > 1 ? `~${count}` : ''}`;
  };
}

/**
 * @param {{ event?: CollectionEvent[] }} item
 * @param {ScriptEvent} listen
 * @returns {string[]}
 */
function listEventScripts(item, listen) {
  return (Array.isArray(item?.event) ? item.event : [])
    .filter((event) => event?.listen === listen && Array.isArray(event?.script?.exec))
    .map((event) => /** @type {{ script: { exec: string[] } }} */ (event).script.exec.join('\n'));
}

/**
 * Inventories every pm.test block and matcher site in an item's scripts.
 *
 * @param {{ event?: CollectionEvent[] }} item
 * @param {string} ownerId
 * @returns {ScriptInventory}
 */
function inventoryScripts(item, ownerId) {
  const allocateTestId = createIdAllocator(ownerId);
  /** @type {ScriptInventory} */
  const inventory = { pmTests: [], unownedMatchers: [] };
  let unownedCount = 0;

  SCRIPT_EVENTS.forEach((listen) => {
    listEventScripts(item, listen).forEach((source) => {
      const masked = maskLiterals(source);
      const blocks = Array.from(masked.matchAll(PM_TEST_PATTERN), (match) => {
        const openParen = /** @type {number} */ (match.index) + match[0].length - 1;
        const { name, dynamicName } = readTestName(source, openParen + 1);

        return {
          start: /** @type {number} */ (match.index),
          end: findClosingBracket(masked, openParen),
          block: /** @type {PmTestBlock} */ ({
            id: allocateTestId(name),
            name,
            dynamicName,
            event: listen,
            line: lineAt(source, /** @type {number} */ (match.index)),
            matchers: [],
          }),
        };
      });
      const sites = MATCHER_PATTERNS
        .flatMap(({ kind, pattern }) => Array.from(masked.matchAll(pattern), (match) => ({
          kind,
          start: /** @type {number} */ (match.index),
        })))
        .filter((site, siteIndex, all) => all.findIndex((other) => other.start === site.start) === siteIndex)
        .sort((left, right) => left.start - right.start);

      sites.forEach(({ kind, start }) => {
        const owner = blocks
          .filter((block) => block.start < start && start < block.end)
          .at(-1);
        const matcher = {
          kind,
          line: lineAt(source, start),
          source: source.slice(start, findStatementEnd(masked, start)).replace(/\s+/gu, ' ').trim(),
        };

        if (owner) {
          owner.block.matchers.push({
            id: `${owner.block.id}.${owner.block.matchers.length + 1}`,
            ...matcher,
          });
          return;
        }

        unownedCount += 1;
        inventory.unownedMatchers.push({ id: `${ownerId}/-.${unownedCount}`, ...matcher });
      });

      inventory.pmTests.push(...blocks.map(({ block }) => block));
    });
  });

  return inventory;
}

/**
 * @param {CollectionItem} item
 * @returns {string}
 */
function getRawUrl(item) {
  const url = item.request?.url;

  if (typeof url === 'string') {
    return url;
  }

  return typeof url?.raw === 'string' ? url.raw : '';
}

/**
 * @param {ScriptInventory[]} scripts
 * @returns {Omit<InventoryTotals, 'folders' | 'requests'>}
 */
function countAssertions(scripts) {
  const matchers = scripts.flatMap((script) => [
    ...script.pmTests.flatMap((block) => block.matchers),
    ...script.unownedMatchers,
  ]);
  const countKind = (/** @type {MatcherKind[]} */ ...kinds) => matchers
    .filter((matcher) => kinds.includes(matcher.kind))
    .length;

  return {
    pmTests: scripts.reduce((total, script) => total + script.pmTests.length, 0),
    pmExpectSites: countKind('pm.expect', 'pm.expect.fail'),
    responseAssertionSites: countKind('pm.response.to'),
    matcherSites: matchers.length,
  };
}

/**
 * Builds the full assertion inventory of a Postman collection.
 *
 * Request ids are `<folder prefix>:<request slug>`, which stay stable when
 * requests are reordered. Duplicate ids are rejected because the migration
 * manifest keys its mappings by id.
 *
 * @param {PostmanCollection} collection
 * @returns {CollectionInventory}
 */
function buildCollectionInventory(collection) {
  /** @type {Set<string>} */
  const requestIds = new Set();
  const collectionScript = inventoryScripts(collection, COLLECTION_SCRIPT_ID);
  /** @type {ScriptInventory[]} */
  const scripts = [collectionScript];

  const folders = (collection.item ?? []).map((folder) => {
    const folderName = String(folder.name);
    const prefix = folderName.match(/^(\d{2})\s/u)?.[1] ?? slugify(folderName);
    /** @type {CollectionItem[]} */
    const requestItems = [];
    /** @type {CollectionEvent[]} */
    const folderEvents = [];
    const visit = (/** @type {CollectionItem} */ item) => {
      if (item.request) {
        requestItems.push(item);
        return;
      }
      folderEvents.push(...(item.event ?? []));
      (item.item ?? []).forEach(visit);
    };
    visit(folder);

    const folderScript = inventoryScripts({ event: folderEvents }, prefix);
    scripts.push(folderScript);

    const requests = requestItems.map((item) => {
      const id = `${prefix}:${slugify(String(item.name))}`;

      if (requestIds.has(id)) {
        throw new Error(`duplicate request id "${id}" in folder "${folderName}"`);
      }
      requestIds.add(id);

      const script = inventoryScripts(item, id);
      scripts.push(script);

      return {
        id,
        name: String(item.name),
        method: String(/** @type {{ method?: string }} */ (item.request ?? {}).method ?? 'GET'),
        url: getRawUrl(item),
        expectedStatus: getExpectedStatusCode(item),
        skippable: declaresSkipRequest(item),
        ...script,
      };
    });

    return { name: folderName, ...folderScript, requests };
  });

  return {
    totals: {
      folders: folders.length,
      requests: requestIds.size,
      ...countAssertions(scripts),
    },
    collectionScript,
    folders,
  };
}

module.exports = {
  COLLECTION_SCRIPT_ID,
  buildCollectionInventory,
  findClosingBracket,
  findStatementEnd,
  inventoryScripts,
  maskLiterals,
  slugify,
};
