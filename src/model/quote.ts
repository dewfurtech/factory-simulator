import { catalogItem, isMachine, machineInfo, machineOptions } from './catalog';
import type { PlacedObject, Project } from './types';

/**
 * What a layout would cost: each placed machine at its list price (machines/data.js, or the price typed on the
 * placed piece), the same model and add-ons grouped into one line. Machines the price list gives no price for are
 * listed as "ask" and left out of the total, so the total never includes a guess.
 */
export interface QuoteLine {
  key: string;
  assetId: string;
  name: string;
  /** The add-ons ticked on every piece in this line, with their price when the list has one ("ชื่อ (+฿120,000)"). */
  addons: string[];
  /** Some ticked add-on has no price: it is quoted separately, not in `unit`. */
  addonsUnpriced?: boolean;
  /** A remark from the price list (another trim's price, where the price came from). */
  note?: string;
  qty: number;
  /** Baht per piece; null when the list has no price for it. */
  unit: number | null;
  amount: number | null;
}

export interface Quote {
  lines: QuoteLine[];
  total: number;
  /** Lines without a price: the total leaves them out. */
  unpriced: number;
}

/** The price list's price for a model: null when the list has none, undefined for things that are never quoted. */
export function listPrice(assetId: string): number | null | undefined {
  const m = machineInfo(assetId);
  if (m) return typeof m.price === 'number' ? m.price : null;
  const c = catalogItem(assetId)?.custom;
  if (c) return typeof c.price === 'number' ? c.price : undefined;
  return undefined;
}

/** What one placed piece is quoted at, before add-ons: its own price when typed, else the list's. */
export const objectPrice = (o: Pick<PlacedObject, 'assetId' | 'price'>): number | null | undefined =>
  typeof o.price === 'number' ? o.price : listPrice(o.assetId);

/** The add-ons ticked on a placed machine, each with its price (null when the list has none). */
export function chosenAddons(o: Pick<PlacedObject, 'assetId' | 'options'>): { id: string; name: string; price: number | null }[] {
  return machineOptions(o.assetId)
    .filter((a) => o.options?.includes(a.id))
    .map((a) => ({ id: a.id, name: a.name, price: typeof a.price === 'number' ? a.price : null }));
}

/** What the ticked add-ons with a price add to one piece. */
export const addonsPrice = (o: Pick<PlacedObject, 'assetId' | 'options'>): number =>
  chosenAddons(o).reduce((s, a) => s + (a.price ?? 0), 0);

/** One piece with its priced add-ons: null when the machine itself has no price. */
export function piecePrice(o: Pick<PlacedObject, 'assetId' | 'price' | 'options'>): number | null | undefined {
  const base = objectPrice(o);
  return typeof base === 'number' ? base + addonsPrice(o) : base;
}

/** Whether a piece belongs on the quotation: machines always, anything else once it has a price. */
export const isQuoted = (o: Pick<PlacedObject, 'assetId' | 'price'>): boolean => isMachine(o) || objectPrice(o) !== undefined;

export function quoteOf(p: Project): Quote {
  const by = new Map<string, QuoteLine>();
  for (const o of p.objects) {
    if (!isQuoted(o)) continue;
    const unit = piecePrice(o) ?? null;
    const chosen = [...(o.options ?? [])].sort();
    const key = `${o.assetId}|${chosen.join('+')}|${unit ?? 'ask'}`;
    let line = by.get(key);
    if (!line) {
      const info = machineInfo(o.assetId);
      const picked = chosenAddons(o);
      line = {
        key,
        assetId: o.assetId,
        name: info?.name ?? catalogItem(o.assetId)?.label ?? o.name,
        addons: picked.map((a) => (a.price === null ? a.name : `${a.name} (+${fmtBaht(a.price)})`)),
        addonsUnpriced: picked.some((a) => a.price === null) || undefined,
        note: info?.priceNote,
        qty: 0,
        unit,
        amount: unit === null ? null : 0,
      };
      by.set(key, line);
    }
    line.qty++;
    if (line.amount !== null && unit !== null) line.amount += unit;
  }
  const lines = [...by.values()].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.name.localeCompare(b.name, 'th'));
  return { lines, total: lines.reduce((s, l) => s + (l.amount ?? 0), 0), unpriced: lines.filter((l) => l.unit === null).length };
}

export const fmtBaht = (n: number): string => `฿${Math.round(n).toLocaleString('en-US')}`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The quotation as a page of its own, ready to print. */
export function quotationHtml(p: Project, q: Quote, when = new Date()): string {
  const date = when.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const client = p.client ?? {};
  const who = [client.company, client.contact, client.phone].filter(Boolean).map((s) => esc(s!));
  const rows = q.lines
    .map(
      (l, i) => `<tr>
  <td class="n">${i + 1}</td>
  <td><b>${esc(l.name)}</b>${l.addons.length ? `<br><small>+ ${esc(l.addons.join(', '))}</small>` : ''}${l.note ? `<br><small class="muted">${esc(l.note)}</small>` : ''}</td>
  <td class="n">${l.qty}</td>
  <td class="n">${l.unit === null ? '<i>สอบถาม</i>' : fmtBaht(l.unit)}</td>
  <td class="n">${l.amount === null ? '<i>สอบถาม</i>' : fmtBaht(l.amount)}</td>
</tr>`,
    )
    .join('\n');
  const notes: string[] = [];
  if (q.unpriced) notes.push('รายการที่ระบุ “สอบถาม” ยังไม่มีราคาในรายการราคา และไม่รวมอยู่ในยอดรวม');
  if (q.lines.some((l) => l.addonsUnpriced)) notes.push('อุปกรณ์เสริมที่ติ๊กไว้ยังไม่มีราคาในรายการราคา เสนอแยกต่างหาก');
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ใบเสนอราคา – ${esc(p.name)}</title>
<style>
  body { font: 14px/1.5 'Segoe UI', Tahoma, 'Noto Sans Thai', sans-serif; color: #111; margin: 0; padding: 32px 40px; }
  h1 { font-size: 24px; margin: 0 0 2px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 20px; }
  .muted { color: #666; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #ddd; vertical-align: top; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; font-size: 13px; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  small { font-size: 12px; }
  tfoot td { border-bottom: 0; font-size: 16px; font-weight: 700; padding-top: 14px; }
  .notes { margin-top: 20px; font-size: 12px; color: #555; }
  .notes li { margin: 2px 0; }
  .sign { display: flex; justify-content: space-between; margin-top: 56px; font-size: 13px; }
  .sign div { width: 40%; border-top: 1px solid #999; padding-top: 6px; text-align: center; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="head">
  <div>
    <h1>ใบเสนอราคา</h1>
    <div class="muted">Quotation</div>
  </div>
  <div style="text-align:right">
    <div><b>${esc(p.name)}</b></div>
    ${who.length ? `<div>${who.join(' · ')}</div>` : ''}
    <div class="muted">วันที่ ${esc(date)}</div>
  </div>
</div>
<table>
  <thead><tr><th class="n">#</th><th>รายการ</th><th class="n">จำนวน</th><th class="n">ราคา/เครื่อง</th><th class="n">รวม</th></tr></thead>
  <tbody>
${rows || '<tr><td colspan="5" class="muted">ยังไม่มีเครื่องจักรในผัง</td></tr>'}
  </tbody>
  <tfoot><tr><td colspan="4" class="n">รวมทั้งสิ้น</td><td class="n">${fmtBaht(q.total)}</td></tr></tfoot>
</table>
${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<div class="sign"><div>ผู้เสนอราคา</div><div>ผู้อนุมัติ</div></div>
</body></html>`;
}

/**
 * Prints the quotation: the page is laid out in a hidden frame of this window (no popup for the browser to block)
 * and the print dialog opens over it. The frame goes once the dialog closes.
 */
export function printQuotation(p: Project): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-testid', 'quote-frame');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = quotationHtml(p, quoteOf(p));
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return;
    w.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 100));
    w.focus();
    w.print();
  };
  document.body.appendChild(frame);
}
