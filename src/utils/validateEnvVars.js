// utils/validateEnvVars.js
const Joi = require('joi');

module.exports.validateEnvVars = () => {
  const envVarsSchema = Joi.object({
    PORT: Joi.number().optional(),
    TLS_PORT: Joi.number().optional(),
    // Add other environment variables as needed
  }).unknown();

  const { error } = envVarsSchema.validate(process.env);
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
};
