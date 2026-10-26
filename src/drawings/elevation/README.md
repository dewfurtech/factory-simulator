# Interior wall elevations (รูปด้านผนังภายใน)

Turns an interior project into one elevation per wall face of every room, as plain 2D primitives
(`src/drawings/types.ts`). Pure functions: no DOM, no three.js, no store. Every line and figure comes from the model;
nothing is assumed except the two drawing symbols noted below.

## API

```ts
import { elevations } from '../drawings/elevation';

const els = elevations(project, level /* 0 ground, 1 upper */, { scale: 30 });
```

Each `Elevation`:

| field                               | meaning                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `roomId`, `roomName`                | the room it belongs to                                                                                         |
| `label`                             | `A`, `B`, … clockwise round the room (as the plan shows it), starting with the face you see looking north      |
| `wallIds`                           | walls making the face, left to right (walls in line are one face)                                              |
| `from`, `to`                        | left and right ends of the face on the inner wall surface, **plan** coordinates                                |
| `normal`                            | unit normal of the face in plan coordinates, from the wall **into the room**; the viewer looks along `-normal` |
| `looking`                           | compass direction the viewer looks, degrees clockwise from north (0 N, 90 E, 180 S, 270 W)                     |
| `width`, `height`                   | face length and floor-to-ceiling height (`ceilingHeight`, or the wall top if lower)                            |
| `cutLeft`, `cutRight`               | thickness of the wall cut at each end (0 at an outside corner)                                                 |
| `openings`, `cabinets`, `furniture` | what was drawn and where, in elevation mm (handy for tags and tests)                                           |
| `notes`                             | the material notes (`ผนัง:`, `พื้น:`, `ฝ้า:`)                                                                  |
| `drawing`                           | `{ title: 'ELEVATION A / รูปด้าน A · ห้องนอน', prims }`                                                        |

`roomElevations(project, level, room)` gives one room's; `roomFaces(plan, room)` the faces alone; `cabinetFront(spec,
at)` a cabinet's front view on its own.

### Elevation space

`x` runs along the face from its left end as seen standing in the room facing the wall; `y` is the height above the
room's floor. The face is `x 0..width`, `y 0..height`. The cut walls lie outside it (`x < 0`, `x > width`), the
ceiling band above it. The dimensions run below (`offset` −8 and −16 paper mm) and to the right of `width + cutRight`;
the material notes sit right of those, `(8 × rows + 10) × scale` mm out, which is why `scale` is an option.

### What is drawn

- **Walls** (`wall`): floor line `cut`; the walls cut at each end as `poche` rectangles their real thickness; an
  outside corner as a `thick` line; the ceiling as a `poche` band `CEILING_BAND` (60 mm) deep. A wall that stops below
  the ceiling shows its top.
- **Openings** (`opening`): outline `medium`, a frame line `FRAME` (50 mm) inside `thin`. Swing doors: lines from the
  free edge's corners to the middle of the hinge edge, solid when the leaf swings toward the viewer, dashed when away
  (from `hingeEnd` / `openB`, the same as the plan symbol). Double doors: both leaves. Sliding: the leaf joint and the
  way each leaf runs. Windows: two frames at the real `sill` and `height`.
- **Cabinets** (`cabinet`): a cabinet whose back is within 50 mm of the face and whose front faces the room is drawn
  from `cabinetPieces()` (`src/interior/cabinet/parts.ts`) — the same pieces as the cut list and the 3D model: carcass
  outline, plinth board, countertop, each door (dashed opening mark from its `hinge`), each drawer front, and in an open
  bay its opening and shelves. A wall cabinet sits at its real `z`. Other cabinets near the face show as outlines.
- **Furniture** (`furniture`): pieces square to the wall whose nearest edge is within 1,000 mm of the face, as thin
  outlines of their projected size with their name (names that would collide go up a line). Further pieces are left out.
- **Materials** (`annotation`): leaders to the ceiling, each run of the face in one material (the wall's own finish,
  honouring `finishSide`, else the room's), and the floor. No hatching.
- **Dimensions** (`dim`): along the bottom, wall end → openings → built-in cabinets → wall end, then the whole width;
  up the right, floor → sills, heads, cabinet undersides and tops → ceiling, then the ceiling height. Figures are left
  for the renderer to write from the measured length.

`CEILING_BAND` and `FRAME` are symbols with no size in the model, and are never dimensioned.

## Placing on an A3 sheet

An A3 landscape sheet is 420 × 297 mm; with a 10 mm border and a title block of about 50 mm along the right or bottom,
the drawing area is roughly 350 × 270 mm.

A typical room face is 3–5 m wide and 2.4–2.7 m high. With its cut walls, dimensions (about 20 mm paper below and right)
and the material notes (about 45 mm paper to the right), one elevation takes:

| face        | at 1:30      | at 1:40     | at 1:50     |
| ----------- | ------------ | ----------- | ----------- |
| 3.0 × 2.6 m | 170 × 110 mm | 140 × 90 mm | 125 × 80 mm |
| 5.3 × 2.6 m | 245 × 110 mm | 200 × 90 mm | 170 × 80 mm |

- **1:30** — two elevations of a 3–4 m wall stacked on one sheet, or one long kitchen wall with room for a section.
  Best for kitchen and wardrobe walls, where door and drawer lines are read off the drawing.
- **1:40** — two per sheet for walls up to about 6 m (stacked), four for a small room (2 × 2).
- **1:50** — a whole room's four faces on one sheet, for walls with nothing built in.

Number the sheets `ID-09-xx` per room and use each `label` both on the sheet and in the elevation marks on the plan:
draw the mark at the room's centre (or near `(from + to) / 2`) pointing along `-normal`.

## Looking at it

`npm run dev`, then open `/sandbox/elevation.html` (add `?room=ห้องนอน&label=C` for one). The sandbox has its own
minimal SVG renderer at 1:30; the sheet renderer proper lives with the A3 sheet system.
