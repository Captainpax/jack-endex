/**
 * Shared immutable empty array reference.
 * Useful for memoized selectors/hooks to avoid allocating new arrays.
 * @type {readonly any[]}
 */
export const EMPTY_ARRAY = Object.freeze([]);

/**
 * Shared immutable empty object reference.
 * Helps prevent re-renders when consumers expect referential stability.
 * @type {Readonly<Record<string, never>>}
 */
export const EMPTY_OBJECT = Object.freeze({});
