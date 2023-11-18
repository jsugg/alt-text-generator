// middlewares/applyMiddlewares.js
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
// const cors = require('cors');

// const corsOptions = {
//   origin(origin, callback) {
//     // Customize this to list allowed origins, or use '*' to allow all
//     const allowedOrigins = ['https://localhost', 'http://localhost',
//       'http://127.0.0.1', 'https://127.0.0.1', 'https://qcraft.com.br'];
//     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
//   allowedHeaders: ['Content-Type', 'Authorization'],
// };

module.exports.applyMiddlewares = (app) => {
  app.use(helmet());
  // app.use(cors(corsOptions));

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.',
  }));
};
