import { autoTrace, type WallStyle } from '../model/trace/scale';

export interface TraceRequest {
  gray: Uint8Array;
  w: number;
  h: number;
  /** Mm per pixel when the scale is known; read off the doors otherwise. */
  given?: number;
  styles: WallStyle[];
}

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { gray, w, h, given, styles } = e.data;
  try {
    self.postMessage({ ok: true, result: autoTrace({ w, h, data: gray }, given, styles) });
  } catch (err) {
    self.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
