const providerDefinitions = require('../../../src/providers/definitions');
const {
  assertEveryProviderIsRegistered,
  providerAdapterContracts,
  runProviderAdapterContractMatrix,
} = require('../../helpers/providerAdapterContractMatrix');

describe('Unit | Providers | Adapter Contract Matrix', () => {
  it('registers every supported provider definition in the fast contract matrix', () => {
    assertEveryProviderIsRegistered({
      providerDefinitions,
      providerContracts: providerAdapterContracts,
    });
  });

  runProviderAdapterContractMatrix({
    providerDefinitions,
    providerContracts: providerAdapterContracts,
  });
});
