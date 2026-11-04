import { useEffect, useMemo, useState } from 'react';
import { CATALOG, GROUP_LABEL, GROUP_ORDER, type CatalogGroup, type CatalogItem } from '../model/catalog';
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

const fmtSize = (c: CatalogItem) => `${(c.size.w / 1000).toFixed(1)}×${(c.size.d / 1000).toFixed(1)} ม.`;

/** Not machines, but what a layout needs beside them. The rest of the built-in furniture stays in CATALOG only so plans that hold it keep drawing. */
const EQUIPMENT = new Set(['mdb', 'panel-cart', 'pallet', 'finished-pallet']);
const shown = (c: CatalogItem) => c.use === 'machine' || c.group === 'scale' || EQUIPMENT.has(c.id);
const SHELVES = GROUP_ORDER.map((g) => ({ g, items: CATALOG.filter((c) => c.group === g && shown(c)) })).filter((x) => x.items.length);
/** Headings for the groups that hold only the equipment above. */
const HEADING: Partial<Record<CatalogGroup, string>> = { production: 'ตู้ไฟ', storage: 'รถเข็นและพาเลท' };

/** Every machine in sight, by kind: click and put it down on the plan, or drag it there. */
export function CatalogPanel() {
  const [tag, setTag] = useState<string | null>(null);
  const [form, setForm] = useState<{ model?: CustomModel } | null>(null);
  const models = useLibrary((s) => s.models);
  const tags = useMemo(() => allTags(models), [models]);
  const customer = useUi((s) => !!s.customer);
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
  const mine: CatalogItem[] = models.filter((m) => matchesTag(m, tag)).map((m) => ({ id: m.id, label: m.name, group: 'custom', size: m.size, summary: m.note, custom: m }));
  const card = (c: CatalogItem) => {
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
  };
  return (
    <div className="dock-body" data-testid="catalog">
      <h3 className="dock-title">เครื่องจักร</h3>
      <div className="dock-scroll">
        {!customer && (
          <button className="btn wide" onClick={() => useUi.getState().set({ starterOpen: true })} data-testid="starter-open">
            <Icon name="bulb" />
            แนะนำชุดเครื่องให้
          </button>
        )}
        {SHELVES.map(({ g, items }) => (
          <section key={g} className="cat-group">
            <h4>{HEADING[g] ?? GROUP_LABEL[g]}</h4>
            <div className="cat-grid">{items.map(card)}</div>
          </section>
        ))}
        {!customer && (
          <section className="cat-group">
            <h4 className="cat-mine">
              โมเดลของฉัน
              <button className="ib sm" onClick={() => setForm({})} title="เพิ่มโมเดล" aria-label="เพิ่มโมเดล" data-testid="add-model">
                <Icon name="plus" />
              </button>
            </h4>
            {tags.length > 0 && (
              <div className="cat-chips">
                <button className={`chip${tag === null ? ' on' : ''}`} onClick={() => setTag(null)}>
                  ทั้งหมด
                </button>
                {tags.map((t) => (
                  <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)} data-testid={`tag-${t}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            {mine.length > 0 && <div className="cat-grid">{mine.map(card)}</div>}
          </section>
        )}
      </div>
      {form && <ModelForm model={form.model} onClose={() => setForm(null)} />}
    </div>
  );
}
