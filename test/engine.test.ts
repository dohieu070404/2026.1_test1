import { AppEngine } from "../src/state/engine";
test("simulation never sends sensor data to the API or creates a real capture", () => {
  jest.useFakeTimers();
  const e = new AppEngine();
  e.api.post = jest.fn();
  e.startSimulation();
  jest.advanceTimersByTime(100);
  expect(e.views.left.count).toBe(10);
  expect(e.views.right.count).toBe(10);
  expect(e.api.post).not.toHaveBeenCalled();
  expect(e.capture).toBe(null);
  e.stopSimulation();
  jest.useRealTimers();
});
test("background closes acquisition rather than promising a persistent JS process", async () => {
  const e = new AppEngine();
  e.ble.stopScan = jest.fn();
  e.stop = jest.fn(async () => {});
  e.capture = { state: "recording" } as any;
  await e.background();
  expect(e.stop).toHaveBeenCalledTimes(1);
});

test("Expo reload cleanup releases capture timers and does not leak a simulation interval", async () => {
  jest.useFakeTimers();
  const engine = new AppEngine();
  engine.ble.disconnectAll = jest.fn(async () => {});
  await engine.initialize();
  engine.startSimulation();
  expect(jest.getTimerCount()).toBe(3);
  await engine.dispose();
  expect(jest.getTimerCount()).toBe(0);
  expect(engine.simulation).toBe(false);
  jest.useRealTimers();
});
