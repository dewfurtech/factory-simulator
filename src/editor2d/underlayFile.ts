import { newId } from '../model/id';
import type { Id } from '../model/types';
import { saveAsset } from '../store/persist';

/** Longest side a PDF page is rendered to: sharp enough to trace a house plan zoomed in. */
const PDF_PX = 6000;

export const UNDERLAY_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.pdf';

export interface UnderlayImage {
  imageId: Id;
  name: string;
  w: number;
  h: number;
}

/** Stores a picked plan image, or the first page of a PDF rendered to PNG, and reports its pixel size. */
export async function storeUnderlayFile(file: File): Promise<UnderlayImage> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const { blob, w, h } = isPdf ? await renderPdf(file) : await measureImage(file);
  const imageId = newId('u');
  await saveAsset(imageId, blob);
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

async function renderPdf(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const [pdfjs, { default: workerSrc }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_PX / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    // PDF pages are transparent; the plan reads on white like the paper it was drawn for.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('แปลง PDF ไม่สำเร็จ'))), 'image/png'));
    return { blob, w: canvas.width, h: canvas.height };
  } finally {
    await doc.destroy();
  }
}
