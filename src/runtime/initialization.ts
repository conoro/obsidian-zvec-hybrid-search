export async function initializeThenPublish(
  initialize: () => Promise<void>,
  publish: () => void,
): Promise<void> {
  await initialize();
  publish();
}
