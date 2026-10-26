import type { Project } from '../model/types';

/**
 * The project as a share link sends it: the seller's own notes stay with the seller. That is the customer details
 * (contact, phone, budget) and the prices typed into an interior's BOQ quote. An exported file keeps both.
 */
export function withoutPrivate(project: Project): Project {
  const { client: _client, priceBook: _prices, ...rest } = project;
  void _client;
  void _prices;
  return rest;
}
