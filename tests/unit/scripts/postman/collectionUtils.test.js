const {
  assertTopLevelFoldersExist,
  buildItemFolderMap,
  listTopLevelFolderNames,
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
});
