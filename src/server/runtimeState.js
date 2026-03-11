const createRuntimeState = ({ initialReady = false } = {}) => {
  let ready = initialReady;
  let draining = false;

  return {
    isDraining: () => draining,
    isReady: () => ready && !draining,
    markDraining: () => {
      draining = true;
      ready = false;
    },
    markReady: () => {
      draining = false;
      ready = true;
    },
  };
};

module.exports = {
  createRuntimeState,
};
