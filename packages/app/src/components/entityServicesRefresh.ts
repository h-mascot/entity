export interface RefreshableRegistryPayload {
  state?: string;
}

interface RefreshRegistryOptions<T extends RefreshableRegistryPayload> {
  request: (forceRefresh: boolean) => Promise<T>;
  wait?: () => Promise<void>;
  maxPolls?: number;
}

const waitOneSecond = () => new Promise<void>((resolve) => setTimeout(resolve, 1_000));

export async function refreshServiceRegistryUntilSettled<T extends RefreshableRegistryPayload>({
  request,
  wait = waitOneSecond,
  maxPolls = 10,
}: RefreshRegistryOptions<T>): Promise<T> {
  let payload = await request(true);
  for (let poll = 0; payload.state === 'refreshing' && poll < maxPolls; poll += 1) {
    await wait();
    payload = await request(false);
  }
  return payload;
}
