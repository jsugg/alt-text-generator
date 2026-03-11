const { createRuntimeState } = require('../../../src/server/runtimeState');

describe('Unit | Server | Runtime State', () => {
  it('starts not ready by default', () => {
    const runtimeState = createRuntimeState();

    expect(runtimeState.isReady()).toBe(false);
    expect(runtimeState.isDraining()).toBe(false);
  });

  it('transitions to ready and then draining', () => {
    const runtimeState = createRuntimeState();

    runtimeState.markReady();
    expect(runtimeState.isReady()).toBe(true);
    expect(runtimeState.isDraining()).toBe(false);

    runtimeState.markDraining();
    expect(runtimeState.isReady()).toBe(false);
    expect(runtimeState.isDraining()).toBe(true);
  });
});
