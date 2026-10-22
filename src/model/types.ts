export type Id = string & { __brand: 'Id' };
export type Mm = number;

export interface Vec2 {
  x: number;
  y: number;
}

/** A point people walk through: which floor it is on (0 = ground) and, on a stair, its height. */
export interface Place extends Vec2 {
  level?: number;
  z?: number;
}

export interface Corner {
  id: Id;
  x: Mm;
  y: Mm;
}

/** Layer flags shared by walls, rooms and objects; absent means visible and editable. */
export interface LayerFlags {
  hidden?: boolean;
  locked?: boolean;
}

export interface Wall extends LayerFlags {
  id: Id;
  a: Id;
  b: Id;
  thickness: Mm;
  height: Mm;
  /** A framed glass partition instead of a solid wall. */
  glass?: boolean;
  /** Plain color of both faces; absent means the default wall color. */
  color?: string;
}

/** What a closed area of the plan is used for; drives its floor color and what people go there for. */
export type ZoneKind =
  | 'production'
  | 'warehouse'
  | 'office'
  | 'meeting'
  | 'canteen'
  | 'break'
  | 'toilet'
  | 'locker'
  | 'reception'
  | 'showroom'
  | 'maintenance'
  | 'qc'
  | 'loading'
  | 'corridor'
  | 'other';

export interface Room extends LayerFlags {
  id: Id;
  name: string;
  zone: ZoneKind;
  /** Ordered with positive shoelace area in plan coordinates. */
  cornerIds: Id[];
  ceilingHeight: Mm;
  /** Overrides the zone's floor color. */
  color?: string;
  /** A yard or car park closed off only by a fence: outdoors, so not counted as a room or in the floor area. */
  outdoor?: true;
}

export type OpeningKind = 'door' | 'window' | 'opening';
export type DoorStyle = 'swing' | 'double' | 'sliding' | 'slidingDouble' | 'rolling';

export interface Opening {
  id: Id;
  wallId: Id;
  kind: OpeningKind;
  /** Center, measured from corner a along the wall. */
  offset: Mm;
  width: Mm;
  height: Mm;
  sill: Mm;
  doorStyle?: DoorStyle;
  hingeEnd?: boolean;
  openB?: boolean;
  /** The way people come in and leave at the start and end of the day. */
  entrance?: boolean;
}

/**
 * A marked-out floor area: a named translucent box standing on the floor, apart from the walls and rooms.
 * Its outline is free points, not wall corners, so it can cross walls and rooms.
 */
export interface Area extends LayerFlags {
  id: Id;
  name: string;
  /** Closed outline in plan coordinates, in drawing order. */
  points: Vec2[];
  color: string;
  /** Height of the box in 3D. */
  height: Mm;
}

/** Who uses an aisle: people on foot, forklifts one way or both ways, or forklifts and people together. */
export type AisleKind = 'walk' | 'forklift' | 'forklift2' | 'mixed';

/** A marked traffic route on the floor: a strip of a set width along a centre line, painted with edge lines. */
export interface Aisle extends LayerFlags {
  id: Id;
  name: string;
  kind: AisleKind;
  /** Centre line in plan coordinates, two points or more. */
  points: Vec2[];
  /** Clear width between the edge lines. */
  width: Mm;
  /** Forklift aisles: width of the widest truck or load using it, which sets the standard width. */
  vehicle?: Mm;
  /** Laid out by the auto planner: running it again replaces these and leaves hand-drawn ones alone. */
  auto?: true;
  /** Aisles touching this one that the user chose not to join to it; kept on both of the pair. */
  apart?: Id[];
}

export interface Plan {
  corners: Record<Id, Corner>;
  walls: Record<Id, Wall>;
  rooms: Record<Id, Room>;
  openings: Record<Id, Opening>;
  /** Absent on plans saved before areas existed. */
  areas?: Record<Id, Area>;
  /** Absent on plans saved before aisles existed. */
  aisles?: Record<Id, Aisle>;
}

export interface Size3 {
  w: Mm;
  d: Mm;
  h: Mm;
}

/** A structural column (pillar). */
export interface Column extends LayerFlags {
  id: Id;
  x: Mm;
  y: Mm;
  shape: 'rect' | 'round';
  /** Width along the column's rotated x, or the diameter of a round one. */
  w: Mm;
  d: Mm;
  h: Mm;
  rotation: number;
}

export interface PlacedObject extends LayerFlags {
  id: Id;
  /** A catalog id: a Mastrox machine or a built-in piece. */
  assetId: string;
  name: string;
  /** Footprint center in plan coordinates. */
  x: Mm;
  y: Mm;
  z: Mm;
  /** Radians, plan rotation of the object's local +x axis. Its front (where people stand) is local +y. */
  rotation: number;
  size: Size3;
  /** Machines only: ids of the add-ons ticked for this one (see catalog machineOptions); the size then covers them. */
  options?: string[];
  /** Machines only: average breakdowns per working day, overriding the project default. */
  breakdownsPerDay?: number;
}

/** An image of an existing plan placed in plan coordinates. */
export interface Underlay {
  imageId: Id;
  name: string;
  w: number;
  h: number;
  x: Mm;
  y: Mm;
  mmPerPx: number;
  calibrated?: true;
  rotation: number;
  opacity: number;
  hidden?: boolean;
}

export interface Project {
  id: Id;
  name: string;
  updatedAt: number;
  plan: Plan;
  columns: Record<Id, Column>;
  objects: PlacedObject[];
  underlay?: Underlay;
  /** A second floor over part of the building, with its own walls, rooms and doors. */
  upper?: UpperFloor;
}

export interface UpperFloor {
  /** Height of its floor surface above the ground floor, mm. Objects at or above UPPER_FROM are on it. */
  z: Mm;
  plan: Plan;
  /** The walking line up the stair from the ground floor (level 0, z 0) to this floor (level 1). */
  stair?: Place[];
  /** Openings in the floor (the stairwell) that nobody walks across. */
  voids?: Vec2[][];
}
