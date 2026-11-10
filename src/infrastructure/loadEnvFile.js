const dotenv = require('dotenv');

/**
 * Loads the env file before any other module reads `process.env`.
 *
 * `ENV_FILE` names an explicit file whose values override the inherited
 * environment; otherwise `.env` only fills variables that are still unset.
 * `quiet` keeps dotenv's "injected env" banner (printed by default since
 * dotenv 17, on stderr since 18) out of the structured log stream.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {typeof dotenv.config} [configure]
 * @returns {ReturnType<typeof dotenv.config>}
 */
function loadEnvFile(env = process.env, configure = dotenv.config) {
  return configure({
    path: env.ENV_FILE || '.env',
    override: Boolean(env.ENV_FILE),
    quiet: true,
  });
}

module.exports = { loadEnvFile };
