/**
 * Deep merges multiple objects into the target object.
 * Arrays are overwritten, not concatenated.
 *
 * @param target The target object to merge into.
 * @param sources The source objects to merge from.
 * @returns The merged target object.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = target[key];

        if (isObject(sourceValue)) {
          if (!targetValue || !isObject(targetValue)) {
            target[key] = {} as T[Extract<keyof T, string>];
          }
          deepMerge(
            target[key] as Record<string, unknown>,
            sourceValue as Record<string, unknown>,
          );
        } else if (sourceValue !== undefined) {
          target[key] = sourceValue as T[Extract<keyof T, string>];
        }
      }
    }
  }

  return deepMerge(target, ...sources);
}

/**
 * Checks if a value is a plain object.
 *
 * @param item The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
export function isObject(item: unknown): item is Record<string, unknown> {
  return (
    item !== null &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    !(item instanceof Date) &&
    !(item instanceof RegExp) &&
    !(item instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(item)
  );
}
