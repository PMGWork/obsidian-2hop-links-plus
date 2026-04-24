import { FileEntity } from "./model/FileEntity";
import { isImagePath, normalizeLinkTarget } from "./utils";

export async function readPreview(fileEntity: FileEntity) {
  const linkText = normalizeLinkTarget(fileEntity.linkText);

  if (isImagePath(fileEntity.linkText)) {
    return "";
  }

  if (
    fileEntity.linkText.match(/\.[a-z0-9_-]+$/i) &&
    !fileEntity.linkText.match(/\.(?:md|markdown|txt|text)$/i)
  ) {
    console.debug(`${fileEntity.linkText} is not a plain text file`);
    return "";
  }

  console.debug(
    `readPreview: getFirstLinkpathDest: ${linkText}, fileEntity.linkText=${fileEntity.linkText}
      sourcePath=${fileEntity.sourcePath}`
  );

  const file = this.app.metadataCache.getFirstLinkpathDest(
    linkText,
    fileEntity.sourcePath
  );
  if (file == null) {
    return "";
  }
  if (file.stat.size > 1000 * 1000) {
    // Ignore large file
    console.debug(`File too large(${fileEntity.linkText}): ${file.stat.size}`);
    return "";
  }
  const content = await this.app.vault.cachedRead(file);

  const updatedContent = content.replace(/^(.*\n)?---[\s\S]*?---\n?/m, "");
  const lines = shortenExternalLinkInPreview(updatedContent).split(/\n/);
  return lines
    .filter((it: string) => {
      return it.match(/\S/) && !it.match(/^#/) && !it.match(/^https?:\/\//);
    })
    .slice(0, 6)
    .join("\n");
}

export function shortenExternalLinkInPreview(content: string): string {
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  return content.replace(regex, "[$1](...)");
}
