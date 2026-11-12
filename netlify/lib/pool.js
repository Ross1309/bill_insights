// Run `fn(item, index)` over items with at most `concurrency` running at once.
// Rejects on the first error (like Promise.all); wrap `fn` to collect failures instead.
export async function pool(items, concurrency, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}
