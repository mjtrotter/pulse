// Display units. Everything is stored metric; the profile's `units` setting picks US or metric.
let US = true;
export const setUnits = (u) => { US = u !== "metric"; };
export const isUS = () => US;
export const tempC = (c) => (US ? c * 9 / 5 + 32 : c);
export const tempDelta = (dc) => (US ? dc * 9 / 5 : dc);
export const tempUnit = () => (US ? "°F" : "°C");
export const fmtTemp = (c, digits = 1) => `${tempC(c).toFixed(digits)}${tempUnit()}`;
export const fmtTempDelta = (dc, digits = 1) => { const v = tempDelta(dc); return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}°`; };
export const km = (k) => (US ? k * 0.621371 : k);
export const distUnit = () => (US ? "mi" : "km");
export const kg = (w) => (US ? w * 2.20462 : w);
export const weightUnit = () => (US ? "lb" : "kg");
export const lbToKg = (lb) => lb / 2.20462;
export const ftInToCm = (ft, inch) => (ft * 12 + inch) * 2.54;
export const cmToFtIn = (cm) => { const i = Math.round(cm / 2.54); return [Math.floor(i / 12), i % 12]; };
