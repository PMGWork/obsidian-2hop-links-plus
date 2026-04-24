import { App, CachedMetadata, TFile, parseFrontMatterTags } from "obsidian";
import type { TwohopPluginSettings } from "./settings/TwohopSettingTab";
import { normalizeLinkTarget, shouldExcludePath } from "./utils";

const SIGNATURE_SEPARATOR = "\u001f";

function compactSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value !== ""))).sort();
}

function stringifyFrontmatterValue(value: unknown): string[] {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value.reduce<string[]>(
      (values, item: unknown) => values.concat(stringifyFrontmatterValue(item)),
      []
    );
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [String(value)];
  }

  try {
    return [JSON.stringify(value)];
  } catch {
    return [String(value)];
  }
}

function getCacheLinks(cache: CachedMetadata | null | undefined): string[] {
  if (!cache) return [];

  return compactSorted(
    [
      ...(cache.links ?? []),
      ...(cache.embeds ?? []),
      ...(cache.frontmatterLinks ?? []),
    ].map((link) => normalizeLinkTarget(link.link))
  );
}

function getCacheTags(cache: CachedMetadata | null | undefined): string[] {
  if (!cache) return [];

  const inlineTags = (cache.tags ?? []).map((tag) => tag.tag);
  const frontmatterTags = cache.frontmatter
    ? parseFrontMatterTags(cache.frontmatter) ?? []
    : [];

  return compactSorted([...inlineTags, ...frontmatterTags]);
}

function getConfiguredFrontmatterKeys(
  settings: TwohopPluginSettings
): string[] {
  return compactSorted(settings.frontmatterKeys.map((key) => key.trim()));
}

function getFrontmatterSignature(
  cache: CachedMetadata | null | undefined,
  keys: string[]
): string {
  if (!cache?.frontmatter || keys.length === 0) return "";

  return keys
    .map((key) => {
      const values = compactSorted(
        stringifyFrontmatterValue(cache.frontmatter![key])
      );
      return `${key}=${values.join(SIGNATURE_SEPARATOR)}`;
    })
    .join(SIGNATURE_SEPARATOR);
}

function getFileMetadataSignature(
  app: App,
  file: TFile,
  options: {
    trackTags: boolean;
    frontmatterKeys: string[];
    titleKey: string;
  }
): string {
  const cache = app.metadataCache.getFileCache(file);
  const parts = [file.path];

  if (options.trackTags) {
    parts.push(`tags:${getCacheTags(cache).join(SIGNATURE_SEPARATOR)}`);
  }

  if (options.frontmatterKeys.length > 0) {
    parts.push(
      `frontmatter:${getFrontmatterSignature(cache, options.frontmatterKeys)}`
    );
  }

  if (options.titleKey) {
    parts.push(`title:${getFrontmatterSignature(cache, [options.titleKey])}`);
  }

  return parts.join(SIGNATURE_SEPARATOR);
}

export function getTwohopMetadataSignature(
  app: App,
  activeFile: TFile | null,
  settings: TwohopPluginSettings
): string {
  const activeCache = activeFile
    ? app.metadataCache.getFileCache(activeFile)
    : null;
  const activeTags = getCacheTags(activeCache);
  const frontmatterKeys = getConfiguredFrontmatterKeys(settings);
  const titleKey = settings.frontmatterPropertyKeyAsTitle.trim();
  const trackTags = activeTags.length > 0;

  const parts = [
    `active:${activeFile?.path ?? ""}`,
    `active-links:${getCacheLinks(activeCache).join(SIGNATURE_SEPARATOR)}`,
    `active-tags:${activeTags.join(SIGNATURE_SEPARATOR)}`,
    `active-frontmatter:${getFrontmatterSignature(
      activeCache,
      frontmatterKeys
    )}`,
  ];

  if (trackTags || frontmatterKeys.length > 0 || titleKey) {
    const relatedMetadataSignatures = app.vault
      .getMarkdownFiles()
      .filter((file) => !shouldExcludePath(file.path, settings.excludePaths))
      .map((file) =>
        getFileMetadataSignature(app, file, {
          trackTags,
          frontmatterKeys,
          titleKey,
        })
      )
      .sort();

    parts.push(`vault:${relatedMetadataSignatures.join(SIGNATURE_SEPARATOR)}`);
  }

  return parts.join(SIGNATURE_SEPARATOR);
}
