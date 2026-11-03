type Child = Node | string | null | undefined | false;

/** Minimal element builder. Strings become text nodes, so API text can never inject markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes?: Readonly<Record<string, string>> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes ?? {})) element.setAttribute(name, value);
  for (const child of children) if (child !== null && child !== undefined && child !== false) element.append(child);
  return element;
}
