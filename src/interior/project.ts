import { newProject } from '../model/project';
import type { Project } from '../model/types';

/** A fresh interior project: the same empty plan a factory starts from, marked as an interior. */
export function newInteriorProject(name = 'ห้องใหม่'): Project {
  return { ...newProject(name), kind: 'interior' };
}

export const isInterior = (p: Pick<Project, 'kind'> | null | undefined): boolean => p?.kind === 'interior';
