export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function nodeSlug(value: string) {
  return slugify(value.replace(/^-/, "minus-").replace(/-$/, "-dash")) || encodeURIComponent(value);
}
