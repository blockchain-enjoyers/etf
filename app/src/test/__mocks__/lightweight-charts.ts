const noop = () => {};
const noopObj = { remove: noop, setData: noop, applyOptions: noop };

export const ColorType = { Solid: "Solid" };
export const LineSeries = {};

export function createChart() {
  return {
    addSeries: () => noopObj,
    remove: noop,
    applyOptions: noop,
    resize: noop,
    timeScale: () => ({ fitContent: noop }),
  };
}
