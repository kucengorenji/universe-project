/**
 * Add the methods of the given classes to `target.prototype`, with getters and setters intact. The
 * controllers of the town are groups of methods that work on the town instance's state (they are not
 * objects of their own), so TownMode stays one object for the Director, the journey and the QA hooks.
 * A name defined twice is a mistake and throws.
 */
export function mixin(target, ...sources) {
  for (const source of sources) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source.prototype))) {
      if (key === 'constructor') continue;
      if (Object.hasOwn(target.prototype, key)) throw new Error(`${target.name}.${key} is defined twice`);
      Object.defineProperty(target.prototype, key, descriptor);
    }
  }
  return target;
}
