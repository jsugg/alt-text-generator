const path = require('node:path');

const {
  assertRequestItemsHaveSpecificStatusExpectations,
  assertTopLevelFoldersExist,
  buildItemFolderMap,
  hasExactStatusAssertion,
  hasExpectedStatusCodeHeader,
  hasSpecificStatusExpectation,
  listTopLevelFolderNames,
  listRequestItems,
  readCollection,
} = require('../../../../scripts/postman/collection-utils');

describe('Unit | Scripts | Postman | Collection Utils', () => {
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
      ['00 Core Smoke', '90 Provider Validation'],
      'live mode',
    )).toThrow(
      'Missing Postman folders for live mode: 90 Provider Validation. Available folders: 00 Core Smoke, 20 Single Description (Azure Stub)',
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

  it('detects exact status-code headers on request items', () => {
    expect(hasExpectedStatusCodeHeader({
      request: {
        header: [
          {
            key: 'X-Expected-Status-Code',
            value: '429',
          },
        ],
      },
    })).toBe(true);

    expect(hasExpectedStatusCodeHeader({
      request: {
        header: [
          {
            key: 'X-Expected-Status-Code',
            value: 'not-a-number',
          },
        ],
      },
    })).toBe(false);
  });

  it('treats either a header or an exact assertion as a specific status expectation', () => {
    expect(hasSpecificStatusExpectation({
      request: {
        header: [
          {
            key: 'X-Expected-Status-Code',
            value: '200',
          },
        ],
      },
      event: [],
    })).toBe(true);

    expect(hasSpecificStatusExpectation({
      request: {
        header: [],
      },
      event: [
        {
          listen: 'test',
          script: {
            exec: [
              "pm.test('root service index returns 200', function () {",
              '  pm.response.to.have.status(200);',
              '});',
            ],
          },
        },
      ],
    })).toBe(true);
  });

  it('throws when request items are missing a specific status expectation', () => {
    expect(() => assertRequestItemsHaveSpecificStatusExpectations({
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
      'Missing specific status expectations for Postman requests: 00 Core Smoke > Ping',
    );
  });

  it('enforces specific status expectations across the committed Postman collection', () => {
    const collectionPath = path.join(
      __dirname,
      '../../../../postman/collections/alt-text-generator.postman_collection.json',
    );
    const committedCollection = readCollection(collectionPath);

    expect(() => assertRequestItemsHaveSpecificStatusExpectations(
      committedCollection,
    )).not.toThrow();
  });

  it('keeps provider-validation response-time budgets configurable from the environment', () => {
    const collectionPath = path.join(
      __dirname,
      '../../../../postman/collections/alt-text-generator.postman_collection.json',
    );
    const committedCollection = readCollection(collectionPath);
    const providerValidationRequests = listRequestItems(committedCollection)
      .filter(({ topLevelFolderName }) => (
        topLevelFolderName === '90 Provider Validation'
        || topLevelFolderName === '91 Azure Provider Validation'
      ));

    expect(providerValidationRequests).toHaveLength(4);
    providerValidationRequests.forEach(({ item }) => {
      const responseTimeHeader = item.request.header.find(
        (header) => header.key.toLowerCase() === 'x-max-response-time-ms',
      );

      expect(responseTimeHeader?.value).toBe('{{maxResponseTimeMs}}');
    });
  });
});
