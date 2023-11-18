module.exports = {
  httpPort: process.env.PORT || 8080,
  httpsPort: process.env.TLS_PORT || 8443,

  setupCluster(cluster, os, logger) {
    const numCPUs = os.cpus().length;
    cluster.setupMaster();

    for (let i = 0; i < numCPUs; i += 1) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      logger.info(
        `Worker ${worker.process.pid} died, code: ${code}, signal: ${signal}`
      );
      cluster.fork(); // Restart the worker
    });
  },
};
