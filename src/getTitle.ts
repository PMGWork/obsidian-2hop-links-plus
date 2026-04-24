import { FileEntity } from "./model/FileEntity";
import { formatDisplayTitle, normalizeLinkTarget } from "./utils";

export async function getTitle(fileEntity: FileEntity) {
  const linkText = normalizeLinkTarget(fileEntity.linkText);

  if (!this.settings.frontmatterPropertyKeyAsTitle) {
    return formatDisplayTitle(linkText);
  }
  const file = this.app.metadataCache.getFirstLinkpathDest(
    linkText,
    fileEntity.sourcePath
  );

  if (file == null) return formatDisplayTitle(linkText);
  if (!file.extension?.match(/^(md|markdown)$/))
    return formatDisplayTitle(linkText);

  const metadata = this.app.metadataCache.getFileCache(file);

  if (
    !metadata.frontmatter ||
    !metadata.frontmatter[this.settings.frontmatterPropertyKeyAsTitle]
  )
    return formatDisplayTitle(linkText);

  const title =
    metadata.frontmatter[this.settings.frontmatterPropertyKeyAsTitle];
  return formatDisplayTitle(title);
}
