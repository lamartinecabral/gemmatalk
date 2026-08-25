export const lucideCreateIcons = () => {
  window.lucide.createIcons();
};

/** @type {<T extends keyof HTMLElementTagNameMap>(tag: T, id: string) => HTMLElementTagNameMap[T]} */
export const getElem = (tag, id) => {
  const el = document.getElementById(id);
  if (el?.tagName.toLowerCase() !== tag.toLowerCase())
    throw new Error(`element ${tag}#${id} not found`);
  return el;
};
