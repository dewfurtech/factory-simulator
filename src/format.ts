export const fmtLen = (mm: number) => (Math.abs(mm) >= 1000 ? `${(mm / 1000).toFixed(2)} ม.` : `${Math.round(mm / 10)} ซม.`);
export const fmtArea = (mm2: number) => `${(mm2 / 1e6).toFixed(2)} ม²`;
export const fmtSize = (w: number, d: number) => `${(w / 1000).toFixed(2)} × ${(d / 1000).toFixed(2)} ม.`;
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
