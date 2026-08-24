export function validSelection(
  value: string,
  options: Array<{ id: string }>,
): string {
  return value && options.some((option) => option.id === value)
    ? value
    : (options[0]?.id ?? '');
}

export function channelIsScoped(
  channelId: string,
  scopes: Array<{ channel_id: string }>,
): boolean {
  return Boolean(channelId) && scopes.some((scope) => scope.channel_id === channelId);
}

export function categoryIsScoped(
  categoryId: string,
  channels: Array<{ id: string; category_id?: string }>,
  scopes: Array<{ channel_id: string }>,
): boolean {
  const categoryChannels = channels.filter((channel) => channel.category_id === categoryId);
  return Boolean(categoryId)
    && categoryChannels.length > 0
    && categoryChannels.every((channel) => channelIsScoped(channel.id, scopes));
}

export async function refreshedMutationNotice(refresh: () => Promise<boolean>): Promise<string> {
  return await refresh() ? 'Change saved. Updated state is shown below.' : '';
}
