// is there a better way to get link text?
export function filePathToLinkText(path: string): string {
  return path.replace(/\.md$/, "").replace(/.*\//, "");
}

// Remove block reference. e.g. `[[somefile#^7e8e5f]]`
export function removeBlockReference(src: string): string {
  return src.replace(/#.*$/, "");
}

export function removeDisplayText(src: string): string {
  return src.replace(/\|.*$/, "");
}

export function normalizeLinkTarget(src: string): string {
  return removeDisplayText(removeBlockReference(src));
}

export function isImagePath(path: string): boolean {
  return /\.(?:png|bmp|jpe?g|gif|svg|webp|avif|tiff?|ico|heic|heif)$/i.test(
    normalizeLinkTarget(path)
  );
}

export function formatDisplayTitle(src: string): string {
  return src.replace(/^tags:\s*/i, "").replace(/\.md$/i, "");
}

export function normalizeTagName(src: string): string {
  return formatDisplayTitle(src).trim().replace(/^#/, "");
}

export function expandTagHierarchy(src: string): string[] {
  const normalizedTag = normalizeTagName(src);
  if (!normalizedTag) return [];

  const tagHierarchy = normalizedTag.split("/");
  const tags: string[] = [];
  for (let i = 0; i < tagHierarchy.length; i++) {
    tags.push(tagHierarchy.slice(0, i + 1).join("/"));
  }
  return tags;
}

export function formatTagDisplayTitle(src: string): string {
  const title = normalizeTagName(src);
  return title ? `#${title}` : "";
}

export function shouldExcludePath(
  path: string,
  excludePaths: string[]
): boolean {
  return excludePaths.some((excludePath: string) => {
    if (excludePath.endsWith("/")) {
      return path.startsWith(excludePath);
    } else {
      return path === excludePath;
    }
  });
}
