/** How long a window stays open after its last row: an editor closed within moments of its connect crashes on exit. */
const SETTLE_MILLISECONDS = 2000;

after(async () => {
  await new Promise<void>(resolve => {
    setTimeout(resolve, SETTLE_MILLISECONDS);
  });
});
