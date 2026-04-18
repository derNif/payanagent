export function toPublicAgent<T extends { ownerEmail?: string }>(agent: T): Omit<T, "ownerEmail"> {
  const { ownerEmail: _ignored, ...rest } = agent;
  return rest;
}
