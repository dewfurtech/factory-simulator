import { newId } from '../model/id';
import { extractVectorPlan } from '../model/pdfplan/extract';
import type { VectorPlan } from '../model/pdfplan/types';
import type { Id } from '../model/types';
import type { ImportStage } from '../store/importProgress';
import { vectorAssetId } from '../model/underlay';
import { saveAsset } from '../store/persist';

/** Longest side a PDF page is rendered to: sharp enough to trace a house plan zoomed in. */
export const PDF_PX = 6000;

/** Fewer drawn paths than this and the PDF is a scanned image in a wrapper: it is traced as a picture. */
const MIN_VECTOR_PATHS = 200;

export const UNDERLAY_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.pdf';

export interface UnderlayImage {
  imageId: Id;
  name: string;
  w: number;
  h: number;
}

/** Image pixels per page point of a rendered PDF page. */
export const pdfPxPerPt = (page: { width: number; height: number }) => PDF_PX / Math.max(page.width, page.height);

/**
 * Stores a picked plan image, or the first page of a PDF rendered to PNG, and reports its pixel size. A vector PDF's
 * drawing is stored beside the image (see vectorAssetId), so whichever way the plan is built from, now or after a
 * reload, it is built from the drawing's lines rather than traced off the picture.
 */
export async function storeUnderlayFile(file: File, onStage: (s: ImportStage) => Promise<void> = async () => {}): Promise<UnderlayImage> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const { blob, w, h, vector } = isPdf ? await renderPdf(file, onStage) : { ...(await measureImage(file)), vector: undefined };
  await onStage('save');
  const imageId = newId('u');
  await saveAsset(imageId, blob);
  if (vector) await saveAsset(vectorAssetId(imageId), new Blob([JSON.stringify(vector)], { type: 'application/json' }));
  return { imageId, name: file.name, w, h };
}

async function measureImage(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('เปิดไฟล์ภาพนี้ไม่ได้');
  });
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return { blob: file, ...size };
}

async function renderPdf(file: File, onStage: (s: ImportStage) => Promise<void>): Promise<{ blob: Blob; w: number; h: number; vector?: VectorPlan }> {
  await onStage('render');
  const [pdfjs, { default: workerSrc }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pdfPxPerPt(base) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    // PDF pages are transparent; the plan reads on white like the paper it was drawn for.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Drawn for print: pdf.js paces a display render on animation frames, which a hidden tab never gets, so an import
    // left running in a background tab would stall. A plan's layers print as they show.
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('แปลง PDF ไม่สำเร็จ'))), 'image/png'));
    // A CAD plot keeps its lines; reading them beats tracing the picture. A scan in a PDF has none worth reading.
    await onStage('read');
    const vector = await extractVectorPlan(doc, page).catch(() => undefined);
    return { blob, w: canvas.width, h: canvas.height, ...(vector && vector.paths.length >= MIN_VECTOR_PATHS && { vector }) };
  } finally {
    await doc.destroy();
  }
}
