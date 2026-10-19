// Mutation hook. Every check in iussum goes through fails(name, condition). With IUSSUM_MUTATE=name[,name]
// the named check is skipped (it never reports a violation), which is how scripts/mutation.mjs proves
// that a test fails when a check is broken. In normal runs the set is empty and fails() is just `condition`.
const mutated = new Set((process.env.IUSSUM_MUTATE ?? '').split(',').filter(Boolean));
export const isMutated = (name) => mutated.has(name);
export const fails = (name, condition) => Boolean(condition) && !mutated.has(name);
export const CHECK_NAMES = new Set();
export function registerCheck(name) { CHECK_NAMES.add(name); return name; }
