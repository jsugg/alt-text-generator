const path = require('node:path');

const STUB_DIR = path.resolve(__dirname, '../../../tools/faker-stub');
const MESSAGE = 'Postman dynamic variables are disabled in this repository; '
  + 'remove the {{$...}} expression';

describe('Unit | Tools | Faker stub', () => {
  // eslint-disable-next-line import-x/no-dynamic-require
  const faker = require(STUB_DIR);
  // eslint-disable-next-line import-x/no-dynamic-require
  const fakerEn = require(path.join(STUB_DIR, 'locale', 'en'));

  it('loads from the root and the locale entry used by postman-collection', () => {
    expect(fakerEn).toBe(faker);
  });

  it('lets module initialisation traverse properties without throwing', () => {
    expect(() => faker.address.city).not.toThrow();
    expect(() => faker.datatype.number).not.toThrow();
  });

  it.each([
    [() => faker.address.city(), 'faker.address.city'],
    [() => faker.phone.phoneNumberFormat(0), 'faker.phone.phoneNumberFormat'],
    [() => faker.helpers.fake('{{name.firstName}}'), 'faker.helpers.fake'],
    [() => faker(), 'faker'],
  ])('fails closed with an actionable message (%#)', (call, attempted) => {
    expect(call).toThrow(`${MESSAGE} (attempted ${attempted}())`);
  });

  it('is not a thenable, so awaiting it neither hangs nor throws', async () => {
    expect(faker.then).toBeUndefined();
    await expect(Promise.resolve(faker)).resolves.toBe(faker);
  });

  it('is a private, dependency-free package exposing only the root and locale entries', () => {
    // eslint-disable-next-line import-x/no-dynamic-require
    const manifest = require(path.join(STUB_DIR, 'package.json'));

    expect(manifest).toMatchObject({
      name: '@faker-js/faker',
      version: '0.0.0-security-stub',
      private: true,
      exports: { '.': './index.js', './locale/en': './locale/en.js' },
    });
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
  });
});
