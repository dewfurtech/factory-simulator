import type { Id } from './types';

let counter = 0;

export function newId(prefix = ''): Id {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}` as Id;
}
