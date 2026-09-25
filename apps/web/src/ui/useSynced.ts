import { useState } from 'react';

/**
 * A local copy of a server value for controlled inputs (checkboxes, switches). A change shows
 * in the same event, before the optimistic cache update reaches the component, so the input
 * never flashes its old state; when the server value changes, the copy follows it.
 */
export function useSynced<T>(value: T): [T, (next: T) => void] {
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setLocal(value);
  }
  return [local, setLocal];
}
