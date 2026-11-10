import { fold, parseName, type Kind } from './text.ts';

type Index<T> = Map<string, T[]>;

/**
 * Finds entries in a name index for a user-written name.
 * If the user wrote a type (Phường/Xã/...) and several entries share the name, the type
 * narrows the result; with a single hit the type is ignored, because types change over
 * time (e.g. Xã → Phường) and a stale type must not block a correct match.
 */
export function lookup<T extends { type: string }>(
  index: Index<T> | undefined,
  raw: string,
  kind: Kind,
  accented: boolean,
): { items: T[]; userType: string | null } {
  if (!index) return { items: [], userType: null };
  const { variants, type } = parseName(raw, kind);
  for (const v of variants) {
    // `accented` is true when the WHOLE address uses diacritics: then the exact spelling is
    // meaningful and tried first, so "Thanh An" and "Thanh Ân" stay distinct. An address
    // with no diacritics anywhere carries no spelling information and is matched without
    // them, so it cannot silently pick the one candidate that happens to have none.
    const hit = accented ? (index.get(`p:${v.p}`) ?? index.get(`f:${v.f}`)) : index.get(`f:${v.f}`);
    if (hit?.length) {
      if (type && hit.length > 1) {
        const narrowed = hit.filter((x) => fold(x.type) === type);
        if (narrowed.length) return { items: narrowed, userType: type };
      }
      return { items: hit, userType: type };
    }
  }
  return { items: [], userType: type };
}
