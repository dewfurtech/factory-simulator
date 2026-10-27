import { useEffect, useMemo, useState } from 'react';
import { CATALOG, GROUP_LABEL, GROUP_ORDER, machineInfo, machineOptions, type CatalogGroup, type CatalogItem, type MachineOption } from '../model/catalog';
import { fmtBaht } from '../model/quote';
import { allTags, matchesTag, type CustomModel } from '../model/library';
import { useLibrary } from '../store/library';
import { ModelForm } from './ModelForm';
import { isPhone, useUi } from '../store/ui';
import { ASSET_MIME, setDraggedAsset } from '../editor2d/PlanEditor';
import { placeObjectAt } from '../editor2d/tools';
import { Icon } from '../editor2d/Toolbar';

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // The renderer, three.js and the machine models load with the first thumbnail, not with the app.
    void import('../view3d/thumbs').then(({ thumbnail }) => live && thumbnail(id, (u) => live && setUrl(u)));
    return () => {
      live = false;
    };
  }, [id]);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-wait" />;
}

/** A transparent drag image: the 3D view shows the dragged machine's shape in its place. */
const BLANK =
  typeof Image !== 'undefined'
    ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' })
    : (undefined as unknown as HTMLImageElement);

/**
 * Short ticks for the add-ons the machines in a group offer. What is ticked comes with every one of those machines
 * put down from now on; pieces already on the plan keep their own (changed in their details panel).
 */
function AddonTicks({ ids }: { ids: string[] }) {
  const ticked = useUi((s) => s.placeAddons);
  const customer = useUi((s) => !!s.customer);
  const addons = new Map<string, { a: MachineOption; models: string[] }>();
  for (const id of ids)
    for (const a of machineOptions(id)) {
      const e = addons.get(a.id) ?? { a, models: [] };
      e.models.push(machineInfo(id)?.name ?? id);
      addons.set(a.id, e);
    }
  if (!addons.size || customer) return null;
  const set = (id: string, on: boolean) => useUi.getState().set({ placeAddons: on ? [...ticked, id] : ticked.filter((x) => x !== id) });
  return (
    <div className="cat-addons" data-testid="catalog-addons">
      <span className="cat-addons-label">อุปกรณ์เสริม</span>
      {[...addons.values()].map(({ a, models }) => {
        const on = ticked.includes(a.id);
        return (
          <label
            key={a.id}
            className={`cat-addon${on ? ' on' : ''}`}
            title={`${a.name}${a.note ? `\n${a.note}` : ''}\nใช้กับ ${models.join(', ')} · ติ๊กแล้วเครื่องที่วางต่อจากนี้ติดไปด้วย`}
          >
            <input type="checkbox" checked={on} onChange={(e) => set(a.id, e.target.checked)} data-testid={`catalog-addon-${a.id}`} />
            {a.short ?? a.name}
            <small>{typeof a.price === 'number' ? `+${fmtBaht(a.price)}` : 'สอบถาม'}</small>
          </label>
        );
      })}
    </div>
  );
}

const fmtSize = (c: CatalogItem) => `${(c.size.w / 1000).toFixed(1)}×${(c.size.d / 1000).toFixed(1)} ม.`;

/**
 * The two shelves of the library: the Mastrox lineup comes first, as it is what the app sells, then the user's own
 * models. The standing figure (group 'scale') stands with the machines, there to show their size. The built-in
 * furniture (desks, racks, lockers…) is not offered: those entries stay in CATALOG only so plans that already hold
 * them keep drawing.
 */
type Shelf = 'mastrox' | 'mine';
const shelfOf = (c: CatalogItem): Shelf | null => (c.group === 'custom' ? 'mine' : c.use === 'machine' || c.group === 'scale' ? 'mastrox' : null);
const SHELF_GROUPS: Record<Shelf, CatalogGroup[]> = {
  mastrox: GROUP_ORDER.filter((g) => CATALOG.some((c) => c.group === g && shelfOf(c) === 'mastrox')),
  mine: [],
};
/** Short chip names; the full group label stays as the section heading. */
const CHIP: Partial<Record<CatalogGroup, string>> = {
  nesting: 'CNC Nesting',
  edge: 'ปิดขอบ',
  drill: 'CNC เจาะ',
  other: 'เครื่องเสริม',
  scale: 'เทียบขนาด',
};
const MASTROX_COUNT = CATALOG.filter((c) => c.use === 'machine').length;

const SHELF_KEY = 'catalog.shelf';
const readShelf = (): Shelf => {
  try {
    const s = localStorage.getItem(SHELF_KEY);
    return s === 'mine' ? s : 'mastrox';
  } catch {
    return 'mastrox';
  }
};

/** The library of Mastrox machines and built-in factory pieces: click to place, or drag onto the plan. */
export function CatalogPanel() {
  const [q, setQ] = useState('');
  const [shelf, setShelfState] = useState<Shelf>(readShelf);
  const [group, setGroup] = useState<CatalogGroup | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [form, setForm] = useState<{ model?: CustomModel } | null>(null);
  const models = useLibrary((s) => s.models);
  const tags = useMemo(() => allTags(models), [models]);
  const tool = useUi((s) => s.tool);
  const in3d = useUi((s) => s.view === '3d');
  /** On the plan a click arms the place tool; in 3D there is no plan to click, so the machine lands mid-view, ready to drag. */
  const pick = (assetId: string, on: boolean) => {
    const ui = useUi.getState();
    if (in3d) {
      const at = ui.floorCentre?.();
      if (!at) return;
      const id = placeObjectAt(assetId, at, 300, true);
      ui.set({ selection: { kind: 'object', id }, move3d: true });
      if (isPhone()) ui.set({ dock: null });
      return;
    }
    ui.setTool(on ? { kind: 'select', drag: null } : { kind: 'placeObject', assetId });
    // On a phone the library covers the plan: it steps aside so the machine can be put down.
    if (!on && isPhone()) ui.set({ dock: null });
  };
  const setShelf = (s: Shelf) => {
    setShelfState(s);
    setGroup('all');
    setTag(null);
    try {
      localStorage.setItem(SHELF_KEY, s);
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };
  const searching = q.trim() !== '';
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // A search looks through both shelves (Mastrox first), so nothing hides behind the other tab.
    const mine: CatalogItem[] = models.map((m) => ({ id: m.id, label: m.name, group: 'custom', size: m.size, summary: m.note, custom: m }));
    const shown = [...CATALOG, ...mine].filter(
      (c) =>
        shelfOf(c) !== null &&
        (needle
          ? c.label.toLowerCase().includes(needle) ||
            c.id.includes(needle) ||
            (c.summary ?? '').toLowerCase().includes(needle) ||
            (c.custom?.tags ?? []).some((t) => t.toLowerCase().includes(needle))
          : shelfOf(c) === shelf && (group === 'all' || c.group === group) && (!c.custom || matchesTag(c.custom, tag))),
    );
    return GROUP_ORDER.map((g) => ({ g, items: shown.filter((c) => c.group === g) })).filter((x) => x.items.length);
  }, [q, shelf, group, tag, models]);
  return (
    <div className="dock-body" data-testid="catalog">
      <div className="shelf-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={shelf === 'mastrox'}
          className={`shelf-tab mastrox${shelf === 'mastrox' ? ' on' : ''}`}
          onClick={() => setShelf('mastrox')}
          data-testid="shelf-mastrox"
        >
          <span className="mx-word">
            mas<b>trox</b>
          </span>
          <span className="shelf-count">{MASTROX_COUNT}</span>
        </button>
        <button role="tab" aria-selected={shelf === 'mine'} className={`shelf-tab${shelf === 'mine' ? ' on' : ''}`} onClick={() => setShelf('mine')} data-testid="shelf-mine">
          ของฉัน{models.length > 0 && <span className="shelf-count">{models.length}</span>}
        </button>
      </div>
      <div className="cat-search">
        <div className="search">
          <Icon name="search" />
          <input placeholder={shelf === 'mastrox' ? 'ค้นหาเครื่องจักร Mastrox' : 'ค้นหาชื่อหรือ tag'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {shelf === 'mine' && (
          <button className="btn btn-primary btn-sm" onClick={() => setForm({})} title="เพิ่มโมเดลของคุณเอง" data-testid="add-model">
            <Icon name="plus" /> เพิ่ม
          </button>
        )}
      </div>
      {!searching && shelf === 'mine' && tags.length > 0 && (
        <div className="cat-chips">
          {tags.length > 0 && (
            <button className={`chip${tag === null ? ' on' : ''}`} onClick={() => setTag(null)}>
              ทั้งหมด
            </button>
          )}
          {tags.map((t) => (
            <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)} data-testid={`tag-${t}`}>
              {t}
            </button>
          ))}
        </div>
      )}
      {!searching && shelf === 'mastrox' && (
        <div className="cat-chips">
          {(['all', ...SHELF_GROUPS.mastrox] as const).map((g) => (
            <button key={g} className={`chip${group === g ? ' on' : ''} mx`} onClick={() => setGroup(g)} data-testid={`chip-${g}`}>
              {g === 'all' ? 'ทั้งหมด' : (CHIP[g] ?? GROUP_LABEL[g])}
            </button>
          ))}
        </div>
      )}
      <div className="dock-scroll">
        {!groups.length && shelf === 'mine' && !searching && (
          <div className="cat-none muted">ยังไม่มีโมเดลของคุณ กดปุ่ม “+ เพิ่ม” แล้วตั้งชื่อ ขนาด สี และ tag หรืออัปโหลดไฟล์ 3D (GLB, glTF, OBJ, STL)</div>
        )}
        {!groups.length && (searching || shelf === 'mastrox') && <div className="cat-none muted">ไม่พบ “{q.trim()}”</div>}
        {groups.map(({ g, items }) => (
          <section key={g} className="cat-group">
            <h4 className={SHELF_GROUPS.mastrox.includes(g) ? 'mx' : undefined}>{GROUP_LABEL[g]}</h4>
            <AddonTicks ids={items.map((c) => c.id)} />
            <div className="cat-grid">
              {items.map((c) => {
                const on = tool.kind === 'placeObject' && tool.assetId === c.id;
                return (
                  <button
                    key={c.id}
                    className={`cat-item${on ? ' on' : ''}${c.use === 'machine' ? ' machine' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(ASSET_MIME, c.id);
                      e.dataTransfer.effectAllowed = 'copy';
                      setDraggedAsset(c.id);
                      // No picture follows the cursor: the plan and the 3D view draw the dragged shape where it would land.
                      e.dataTransfer.setDragImage(BLANK, 0, 0);
                    }}
                    onDragEnd={() => setDraggedAsset(null)}
                    onClick={() => pick(c.id, on)}
                    title={`${c.label}${c.summary ? `\n${c.summary}` : ''}\n${fmtSize(c)}`}
                    data-testid={`cat-${c.id}`}
                  >
                    <div className="cat-thumb">
                      <Thumb id={c.id} key={c.custom ? `${c.id}:${c.custom.color}:${c.custom.shape}:${c.size.w}x${c.size.d}x${c.size.h}` : c.id} />
                    </div>
                    <div className="cat-name">{c.label}</div>
                    <div className="cat-size">{fmtSize(c)}</div>
                    {c.custom && c.custom.tags.length > 0 && (
                      <div className="cat-tags">
                        {c.custom.tags.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                    )}
                    {c.custom && (
                      <span
                        role="button"
                        className="cat-edit"
                        title="แก้ไขหรือลบ"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForm({ model: c.custom });
                        }}
                        data-testid={`edit-${c.id}`}
                      >
                        <Icon name="edit" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="dock-foot muted">คลิกแล้ววางบนแปลน หรือลากไปวาง • ด้านที่มีขีดหนาคือด้านหน้า (จุดที่คนยืนทำงาน)</div>
      {form && <ModelForm model={form.model} onClose={() => setForm(null)} />}
    </div>
  );
}
