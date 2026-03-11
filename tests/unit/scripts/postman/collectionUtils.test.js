const path = require('node:path');

const {
  assertRequestItemsHaveExactStatusAssertions,
  assertTopLevelFoldersExist,
  buildItemFolderMap,
  hasExactStatusAssertion,
  listTopLevelFolderNames,
  listRequestItems,
  readCollection,
} = require('../../../../scripts/postman/collection-utils');

describe('scripts/postman/collection-utils', () => {
  const collection = {
    item: [
      {
        name: '00 Core Smoke',
        item: [
          {
            id: 'req-ping',
            name: 'Ping',
            request: {
              method: 'GET',
            },
          },
        ],
      },
      {
        name: '20 Single Description (Azure Stub)',
        item: [
          {
            name: 'Nested Group',
            item: [
              {
                id: 'req-description',
                name: 'Describe fixture image A',
                request: {
                  method: 'GET',
                },
              },
            ],
          },
        ],
      },
    ],
  };

  it('lists the top-level folder names from a collection', () => {
    expect(listTopLevelFolderNames(collection)).toEqual([
      '00 Core Smoke',
      '20 Single Description (Azure Stub)',
    ]);
  });

  it('throws a helpful error when requested folders are missing', () => {
    expect(() => assertTopLevelFoldersExist(
      listTopLevelFolderNames(collection),
      ['00 Core Smoke', '90 Live Provider Validation'],
      'live mode',
    )).toThrow(
      'Missing Postman folders for live mode: 90 Live Provider Validation. Available folders: 00 Core Smoke, 20 Single Description (Azure Stub)',
    );
  });

  it('maps nested request ids and names back to their top-level folder', () => {
    const itemFolderMap = buildItemFolderMap(collection);

    expect(itemFolderMap.get('req-ping')).toBe('00 Core Smoke');
    expect(itemFolderMap.get('Ping')).toBe('00 Core Smoke');
    expect(itemFolderMap.get('req-description')).toBe('20 Single Description (Azure Stub)');
    expect(itemFolderMap.get('Describe fixture image A')).toBe(
      '20 Single Description (Azure Stub)',
    );
  });

  it('lists request items across nested folders', () => {
    expect(listRequestItems(collection).map(({ item }) => item.name)).toEqual([
      'Ping',
      'Describe fixture image A',
    ]);
  });

  it('detects exact status assertions in request test scripts', () => {
    expect(hasExactStatusAssertion({
      name: 'Ping',
      event: [
        {
          listen: 'test',
          script: {
            exec: [
              "pm.test('ping returns 200', function () {",
              '  pm.response.to.have.status(200);',
              '});',
            ],
          },
        },
      ],
    })).toBe(true);

    expect(hasExactStatusAssertion({
      name: 'Dynamic status',
      event: [
        {
          listen: 'test',
          script: {
            exec: [
              "pm.test('status matches runtime expectation', function () {",
              "  pm.expect(pm.response.code, 'message').to.eql(expectedStatus);",
              '});',
            ],
          },
        },
      ],
    })).toBe(true);
  });

  it('throws when request items are missing exact status assertions', () => {
    expect(() => assertRequestItemsHaveExactStatusAssertions({
      item: [
        {
          name: '00 Core Smoke',
          item: [
            {
              name: 'Ping',
              request: { method: 'GET' },
              event: [],
            },
          ],
        },
      ],
    })).toThrow(
      'Missing exact status assertions for Postman requests: 00 Core Smoke > Ping',
    );
  });

  it('enforces exact status assertions across the committed Postman collection', () => {
    const collectionPath = path.join(
      __dirname,
      '../../../../postman/collections/alt-text-generator.postman_collection.json',
    );
    const committedCollection = readCollection(collectionPath);

    expect(() => assertRequestItemsHaveExactStatusAssertions(committedCollection)).not.toThrow();
  });
});
