export const DEFAULT_AVATAR_PLACEHOLDER = '?';

export function avatarPlaceholder(name: string): string {
  const match = name.match(/\p{L}/u);
  return match ? match[0].toUpperCase() : DEFAULT_AVATAR_PLACEHOLDER;
}
