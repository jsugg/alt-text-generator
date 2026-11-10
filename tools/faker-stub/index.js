/**
 * Stands in for `@faker-js/faker` under Newman's `postman-collection`, which
 * loads faker only to resolve `{{$random*}}` dynamic variables. This repository
 * forbids those (postman:lint), so every call fails loudly instead of returning
 * data. Property access stays lazy so module initialisation never throws.
 */
const MESSAGE = 'Postman dynamic variables are disabled in this repository; '
  + 'remove the {{$...}} expression';

/**
 * @param {string} path
 * @returns {any}
 */
function disabledFaker(path) {
  return new Proxy(() => {
    throw new Error(`${MESSAGE} (attempted ${path}())`);
  }, {
    get(_target, property) {
      // Not a thenable: `await` or Promise.resolve on the stub must not recurse.
      if (property === 'then') {
        return undefined;
      }

      return disabledFaker(`${path}.${String(property)}`);
    },
  });
}

module.exports = disabledFaker('faker');
