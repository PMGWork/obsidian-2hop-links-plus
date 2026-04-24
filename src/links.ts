import { App, CachedMetadata, TFile } from "obsidian";
import { FileEntity } from "./model/FileEntity";
import {
  expandTagHierarchy,
  filePathToLinkText,
  isImagePath,
  normalizeLinkTarget,
  normalizeTagName,
  removeBlockReference,
  shouldExcludePath,
} from "./utils";
import { TwohopLink } from "./model/TwohopLink";
import {
  getSortFunction,
  getSortFunctionForFile,
  getSortedFiles,
  getTagHierarchySortFunction,
  getTwoHopSortFunction,
} from "./sort";
import { PropertiesLinks } from "./model/PropertiesLinks";

export class Links {
  app: App;
  settings: any;

  constructor(app: App, settings: any) {
    this.app = app;
    this.settings = settings;
  }

  async gatherTwoHopLinks(activeFile: TFile | null): Promise<{
    forwardLinks: FileEntity[];
    newLinks: FileEntity[];
    backwardLinks: FileEntity[];
    twoHopLinks: TwohopLink[];
    tagLinksList: PropertiesLinks[];
    frontmatterKeyLinksList: PropertiesLinks[];
  }> {
    let forwardLinks: FileEntity[] = [];
    let newLinks: FileEntity[] = [];
    let backwardLinks: FileEntity[] = [];
    let twoHopLinks: TwohopLink[] = [];
    let tagLinksList: PropertiesLinks[] = [];
    let frontmatterKeyLinksList: PropertiesLinks[] = [];

    if (activeFile) {
      const activeFileCache: CachedMetadata =
        this.app.metadataCache.getFileCache(activeFile);
      ({ resolved: forwardLinks, new: newLinks } = await this.getForwardLinks(
        activeFile,
        activeFileCache
      ));
      const seenLinkSet = new Set<string>(forwardLinks.map((it) => it.key()));
      backwardLinks = await this.getBackLinks(activeFile, seenLinkSet);
      backwardLinks.forEach((link) => seenLinkSet.add(link.key()));
      const twoHopLinkSet = new Set<string>();
      twoHopLinks = await this.getTwohopLinks(
        activeFile,
        activeFileCache,
        this.getTwohopLinkMap(),
        seenLinkSet,
        twoHopLinkSet
      );

      tagLinksList = await this.getLinksListOfFilesWithTags(
        activeFile,
        activeFileCache,
        seenLinkSet,
        twoHopLinkSet
      );

      frontmatterKeyLinksList =
        await this.getLinksListOfFilesWithFrontmatterKeys(
          activeFile,
          activeFileCache,
          seenLinkSet,
          twoHopLinkSet
        );
    } else {
      const allMarkdownFiles = this.app.vault
        .getMarkdownFiles()
        .filter(
          (file: { path: string }) =>
            !shouldExcludePath(file.path, this.settings.excludePaths)
        );

      const sortedFiles = await getSortedFiles(
        allMarkdownFiles,
        getSortFunctionForFile(this.settings.sortOrder)
      );

      forwardLinks = sortedFiles.map((file) => new FileEntity("", file.path));
    }

    return {
      forwardLinks,
      newLinks,
      backwardLinks,
      twoHopLinks,
      tagLinksList,
      frontmatterKeyLinksList,
    };
  }

  async getForwardLinks(
    activeFile: TFile,
    activeFileCache: CachedMetadata
  ): Promise<{ resolved: FileEntity[]; new: FileEntity[] }> {
    const resolvedLinks: FileEntity[] = [];
    const newLinks: FileEntity[] = [];

    if (
      activeFileCache != null &&
      (activeFileCache.links != null ||
        activeFileCache.embeds != null ||
        activeFileCache.frontmatterLinks != null)
    ) {
      const seen = new Set<string>();
      const linkEntities = [
        ...(activeFileCache.links || []),
        ...(activeFileCache.embeds || []),
        ...(activeFileCache.frontmatterLinks || []),
      ];

      for (const it of linkEntities) {
        const key = normalizeLinkTarget(it.link);
        if (isImagePath(key)) {
          continue;
        }
        if (!seen.has(key)) {
          seen.add(key);
          const targetFile = this.app.metadataCache.getFirstLinkpathDest(
            key,
            activeFile.path
          );

          if (
            targetFile &&
            (targetFile.path === activeFile.path ||
              isImagePath(targetFile.path) ||
              shouldExcludePath(targetFile.path, this.settings.excludePaths))
          ) {
            continue;
          }

          if (targetFile) {
            resolvedLinks.push(new FileEntity(targetFile.path, key));
          } else {
            const backlinksCount = await this.getBacklinksCount(
              key,
              activeFile.path
            );
            if (
              1 <= backlinksCount &&
              this.settings.createFilesForMultiLinked
            ) {
              await this.app.vault.create(
                `${this.app.workspace.getActiveFile().parent.path}/${key}.md`,
                ""
              );
              resolvedLinks.push(new FileEntity(activeFile.path, key));
            } else {
              newLinks.push(new FileEntity(activeFile.path, key));
            }
          }
        }
      }
    } else if (activeFile.extension === "canvas") {
      const canvasContent = await this.app.vault.read(activeFile);
      let canvasData;
      try {
        canvasData = JSON.parse(canvasContent);
        if (canvasData.nodes) {
          if (!Array.isArray(canvasData.nodes)) {
            console.error("Invalid structure in canvas: nodes is not an array");
            canvasData = { nodes: [] };
          }
        }
      } catch (error) {
        console.error("Invalid JSON in canvas:", error);
        canvasData = { nodes: [] };
      }

      const seen = new Set<string>();
      if (canvasData.nodes) {
        for (const node of canvasData.nodes) {
          if (node.type === "file") {
            const key = normalizeLinkTarget(node.file);
            if (key === activeFile.path || isImagePath(key)) {
              continue;
            }
            if (!seen.has(key)) {
              seen.add(key);
              const targetFile = this.app.vault.getAbstractFileByPath(key);
              if (
                targetFile &&
                !isImagePath(targetFile.path) &&
                !shouldExcludePath(targetFile.path, this.settings.excludePaths)
              ) {
                resolvedLinks.push(new FileEntity(targetFile.path, key));
              } else {
                newLinks.push(new FileEntity(activeFile.path, key));
              }
            }
          }
        }
      }
    }

    const sortedForwardLinks = await this.getSortedFileEntities(
      [...resolvedLinks, ...newLinks],
      (entity) => entity.sourcePath,
      this.settings.sortOrder
    );
    return {
      resolved: sortedForwardLinks,
      new: newLinks,
    };
  }

  async getBacklinksCount(file: string, excludeFile?: string): Promise<number> {
    const unresolvedLinks: Record<string, Record<string, number>> = this.app
      .metadataCache.unresolvedLinks;
    let backlinkCount = 0;

    for (const src of Object.keys(unresolvedLinks)) {
      if (excludeFile && src === excludeFile) {
        continue;
      }
      for (let dest of Object.keys(unresolvedLinks[src])) {
        dest = removeBlockReference(dest);
        if (dest === file) {
          backlinkCount++;
        }
      }
    }
    return backlinkCount;
  }

  async getBackLinks(
    activeFile: TFile,
    forwardLinkSet: Set<string>
  ): Promise<FileEntity[]> {
    const name = activeFile.path;
    const resolvedLinks: Record<string, Record<string, number>> = this.app
      .metadataCache.resolvedLinks;
    const backLinkEntities: FileEntity[] = [];
    for (const src of Object.keys(resolvedLinks)) {
      if (
        src === activeFile.path ||
        shouldExcludePath(src, this.settings.excludePaths)
      ) {
        continue;
      }
      for (const dest of Object.keys(resolvedLinks[src])) {
        if (dest == name) {
          const linkText = filePathToLinkText(src);
          if (
            this.settings.enableDuplicateRemoval &&
            forwardLinkSet.has(linkText)
          ) {
            continue;
          }
          backLinkEntities.push(new FileEntity(src, linkText));
        }
      }
    }

    const allFiles: TFile[] = this.app.vault.getFiles();
    const canvasFiles: TFile[] = allFiles.filter(
      (file) => file.extension === "canvas"
    );

    for (const canvasFile of canvasFiles) {
      if (canvasFile.path === activeFile.path) {
        continue;
      }

      const canvasContent = await this.app.vault.read(canvasFile);
      let canvasData;
      try {
        canvasData = JSON.parse(canvasContent);
        if (canvasData.nodes) {
          if (!Array.isArray(canvasData.nodes)) {
            console.error("Invalid structure in canvas: nodes is not an array");
            canvasData = { nodes: [] };
          }
        }
      } catch (error) {
        console.error("Invalid JSON in canvas:", error);
        canvasData = { nodes: [] };
      }

      if (canvasData.nodes) {
        for (const node of canvasData.nodes) {
          if (node.type === "file" && node.file === activeFile.path) {
            const linkText = filePathToLinkText(canvasFile.path);
            if (!forwardLinkSet.has(linkText)) {
              backLinkEntities.push(new FileEntity(canvasFile.path, linkText));
            }
          }
        }
      }
    }

    return await this.getSortedFileEntities(
      backLinkEntities,
      (entity) => entity.sourcePath,
      this.settings.sortOrder
    );
  }

  async getTwohopLinks(
    activeFile: TFile,
    activeFileCache: CachedMetadata,
    links: Record<string, Record<string, number>>,
    forwardLinkSet: Set<string>,
    twoHopLinkSet: Set<string>
  ): Promise<TwohopLink[]> {
    const twoHopLinks: Record<string, FileEntity[]> = {};
    const twohopLinkList = await this.aggregate2hopLinks(
      activeFile,
      activeFileCache,
      links
    );

    if (twohopLinkList == null) {
      return [];
    }

    let seenLinks = new Set<string>();

    if (twohopLinkList) {
      for (const k of Object.keys(twohopLinkList)) {
        if (twohopLinkList[k].length > 0) {
          const isUnresolvedTwoHopLink =
            this.app.metadataCache.getFirstLinkpathDest(k, activeFile.path) ==
            null;
          twoHopLinks[k] = twohopLinkList[k]
            .filter(
              (it) =>
                it !== activeFile.path &&
                !shouldExcludePath(it, this.settings.excludePaths)
            )
            .map((it) => {
              const linkText = filePathToLinkText(it);
              if (
                this.settings.enableDuplicateRemoval &&
                (forwardLinkSet.has(removeBlockReference(linkText)) ||
                  (!isUnresolvedTwoHopLink && seenLinks.has(linkText)))
              ) {
                return null;
              }
              if (!isUnresolvedTwoHopLink) {
                seenLinks.add(linkText);
              }
              twoHopLinkSet.add(linkText);
              return new FileEntity(it, linkText);
            })
            .filter((it) => it);
        }
      }
    }

    let linkKeys: string[] = [];
    if (activeFile.extension === "canvas") {
      const canvasContent = await this.app.vault.read(activeFile);
      let canvasData;
      try {
        canvasData = JSON.parse(canvasContent);
      } catch (error) {
        console.error("Invalid JSON in canvas:", error);
        canvasData = { nodes: [] };
      }

      if (Array.isArray(canvasData.nodes)) {
        linkKeys = canvasData.nodes
          .filter((node: any) => node.type === "file")
          .map((node: any) => node.file)
          .filter((path: string) => path !== activeFile.path);
      } else {
        linkKeys = [];
      }
    } else {
      linkKeys = this.getActiveFileLinkKeys(activeFile, activeFileCache, links);
    }

    const twoHopLinkEntities = (
      await Promise.all(
        linkKeys
          .filter(
            (path) => !shouldExcludePath(path, this.settings.excludePaths)
          )
          .map(async (path) => {
            if (twoHopLinks[path]) {
              const sortedFileEntities = await this.getSortedFileEntities(
                twoHopLinks[path],
                (entity) => entity.sourcePath,
                this.settings.sortOrder
              );

              return {
                link: new FileEntity(activeFile.path, path),
                fileEntities: sortedFileEntities,
              };
            }
            return null;
          })
      )
    ).filter((it) => it);

    const twoHopLinkStatsPromises = twoHopLinkEntities.map(
      async (twoHopLinkEntity) => {
        let stat = null;
        try {
          stat = await this.app.vault.adapter.stat(
            twoHopLinkEntity.link.linkText
          );
        } catch (error) {
          console.debug(
            `Could not stat 2hop link: ${twoHopLinkEntity.link.linkText}`,
            error
          );
        }
        return { twoHopLinkEntity, stat };
      }
    );

    const twoHopLinkStats = (await Promise.all(twoHopLinkStatsPromises)).filter(
      (it) => it && it.twoHopLinkEntity
    );

    const twoHopSortFunction = getTwoHopSortFunction(this.settings.sortOrder);
    twoHopLinkStats.sort(twoHopSortFunction);

    return twoHopLinkStats
      .map(
        (it) =>
          new TwohopLink(
            it!.twoHopLinkEntity.link,
            it!.twoHopLinkEntity.fileEntities
          )
      )
      .filter((it) => it.fileEntities.length > 0);
  }

  getTwohopLinkMap(): Record<string, Record<string, number>> {
    const links: Record<string, Record<string, number>> = {};
    const addLinks = (
      sourceLinks: Record<string, Record<string, number>> | null | undefined,
      normalizeDest: (dest: string) => string
    ) => {
      if (!sourceLinks) {
        return;
      }

      for (const src of Object.keys(sourceLinks)) {
        links[src] = links[src] ?? {};
        for (const dest of Object.keys(sourceLinks[src])) {
          const normalizedDest = normalizeDest(dest);
          if (!normalizedDest || isImagePath(normalizedDest)) {
            continue;
          }
          links[src][normalizedDest] =
            (links[src][normalizedDest] ?? 0) + sourceLinks[src][dest];
        }
      }
    };

    addLinks(this.app.metadataCache.resolvedLinks, (dest) => dest);
    addLinks(this.app.metadataCache.unresolvedLinks, (dest) =>
      normalizeLinkTarget(dest)
    );

    return links;
  }

  async getDebugSnapshot(activeFile: TFile): Promise<Record<string, unknown>> {
    const activeFileCache = this.app.metadataCache.getFileCache(activeFile);
    const twohopLinkMap = this.getTwohopLinkMap();
    const activeFileLinkKeys = this.getActiveFileLinkKeys(
      activeFile,
      activeFileCache,
      twohopLinkMap
    );
    const aggregate = await this.aggregate2hopLinks(
      activeFile,
      activeFileCache,
      twohopLinkMap
    );
    const twoHopLinks = await this.getTwohopLinks(
      activeFile,
      activeFileCache,
      twohopLinkMap,
      new Set<string>(),
      new Set<string>()
    );
    const rawCacheLinks = [
      ...(activeFileCache?.links || []),
      ...(activeFileCache?.embeds || []),
      ...(activeFileCache?.frontmatterLinks || []),
    ].map((link) => link.link);
    const activeLinkKeyByVariant = this.getLinkKeyByVariant(
      new Set(activeFileLinkKeys)
    );
    const matchingSources: Record<string, string[]> = {};
    Object.entries(twohopLinkMap)
      .filter(([src]) => src !== activeFile.path)
      .forEach(([src, links]) => {
        const matches = Object.keys(links).filter((dest) =>
          Boolean(this.getMatchingLinkKey(dest, activeLinkKeyByVariant))
        );
        if (matches.length > 0) {
          matchingSources[src] = matches;
        }
      });

    return {
      activeFile: activeFile.path,
      settings: {
        showTwohopLinks: this.settings.showTwohopLinks,
        autoLoadTwoHopLinks: this.settings.autoLoadTwoHopLinks,
        enableDuplicateRemoval: this.settings.enableDuplicateRemoval,
        excludePaths: this.settings.excludePaths,
        sortOrder: this.settings.sortOrder,
      },
      rawActiveCacheLinks: rawCacheLinks,
      resolvedLinksFromActiveFile:
        this.app.metadataCache.resolvedLinks?.[activeFile.path] ?? {},
      unresolvedLinksFromActiveFile:
        this.app.metadataCache.unresolvedLinks?.[activeFile.path] ?? {},
      activeFileLinkKeys,
      aggregate2hopLinks: aggregate,
      matchingSources,
      renderedTwoHopLinks: twoHopLinks.map((link) => ({
        linkText: link.link.linkText,
        sourcePath: link.link.sourcePath,
        fileEntities: link.fileEntities.map((entity) => ({
          linkText: entity.linkText,
          sourcePath: entity.sourcePath,
        })),
      })),
      counts: {
        twohopLinkMapSources: Object.keys(twohopLinkMap).length,
        activeFileLinkKeys: activeFileLinkKeys.length,
        aggregate2hopLinks: Object.keys(aggregate).length,
        renderedTwoHopLinks: twoHopLinks.length,
      },
    };
  }

  async aggregate2hopLinks(
    activeFile: TFile,
    activeFileCache: CachedMetadata,
    links: Record<string, Record<string, number>>
  ): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};

    let activeFileLinks = new Set(
      this.getActiveFileLinkKeys(activeFile, activeFileCache, links)
    );

    if (activeFile.extension === "canvas") {
      const canvasContent = await this.app.vault.read(activeFile);
      let canvasData;
      try {
        canvasData = JSON.parse(canvasContent);
        if (canvasData.nodes) {
          if (!Array.isArray(canvasData.nodes)) {
            console.error("Invalid structure in canvas: nodes is not an array");
            canvasData = { nodes: [] };
          }
        }
      } catch (error) {
        console.error("Invalid JSON in canvas:", error);
        canvasData = { nodes: [] };
      }

      if (canvasData.nodes) {
        for (const node of canvasData.nodes) {
          if (node.type === "file") {
            activeFileLinks.add(node.file);
          }
        }
      }
    }

    const activeLinkKeyByVariant = this.getLinkKeyByVariant(activeFileLinks);

    if (links) {
      for (const src of Object.keys(links)) {
        if (src == activeFile.path) {
          continue;
        }
        const link = links[src];
        if (link) {
          for (const dest of Object.keys(link)) {
            const activeLinkKey = this.getMatchingLinkKey(
              dest,
              activeLinkKeyByVariant
            );
            if (activeLinkKey) {
              if (!result[activeLinkKey]) {
                result[activeLinkKey] = [];
              }
              result[activeLinkKey].push(src);
            }
          }
        }
      }
    }
    return result;
  }

  getActiveFileLinkKeys(
    activeFile: TFile,
    activeFileCache: CachedMetadata,
    links: Record<string, Record<string, number>>
  ): string[] {
    const linkKeys = new Set<string>();

    if (links?.[activeFile.path]) {
      Object.keys(links[activeFile.path]).forEach((path) => {
        if (path !== activeFile.path) {
          linkKeys.add(path);
        }
      });
    }

    const linkEntities = [
      ...(activeFileCache?.links || []),
      ...(activeFileCache?.embeds || []),
      ...(activeFileCache?.frontmatterLinks || []),
    ];

    linkEntities.forEach((linkEntity) => {
      const linkText = normalizeLinkTarget(linkEntity.link);
      if (!linkText || isImagePath(linkText)) {
        return;
      }

      const targetFile = this.app.metadataCache.getFirstLinkpathDest(
        linkText,
        activeFile.path
      );
      const linkKey = targetFile ? targetFile.path : linkText;
      if (
        linkKey !== activeFile.path &&
        !shouldExcludePath(linkKey, this.settings.excludePaths)
      ) {
        linkKeys.add(linkKey);
      }
    });

    return Array.from(linkKeys);
  }

  getLinkKeyByVariant(linkKeys: Set<string>): Map<string, string> {
    const linkKeyByVariant = new Map<string, string>();
    linkKeys.forEach((linkKey) => {
      this.getLinkTargetVariants(linkKey).forEach((variant) => {
        if (!linkKeyByVariant.has(variant)) {
          linkKeyByVariant.set(variant, linkKey);
        }
      });
    });
    return linkKeyByVariant;
  }

  getMatchingLinkKey(
    linkTarget: string,
    linkKeyByVariant: Map<string, string>
  ): string | null {
    for (const variant of this.getLinkTargetVariants(linkTarget)) {
      const linkKey = linkKeyByVariant.get(variant);
      if (linkKey) {
        return linkKey;
      }
    }
    return null;
  }

  getLinkTargetVariants(linkTarget: string): string[] {
    const normalizedLinkTarget = normalizeLinkTarget(linkTarget);
    const withoutMarkdownExtension = normalizedLinkTarget.replace(/\.md$/i, "");
    return Array.from(
      new Set([
        normalizedLinkTarget,
        withoutMarkdownExtension,
        filePathToLinkText(normalizedLinkTarget),
        filePathToLinkText(withoutMarkdownExtension),
      ])
    ).filter((variant) => variant !== "");
  }

  async getLinksListOfFilesWithTags(
    activeFile: TFile,
    activeFileCache: CachedMetadata,
    forwardLinkSet: Set<string>,
    twoHopLinkSet: Set<string>
  ): Promise<PropertiesLinks[]> {
    const activeFileTags = this.getTagsFromCache(
      activeFileCache,
      this.settings.excludeTags
    );
    if (activeFileTags.length === 0) return [];

    const activeFileTagSet = new Set(activeFileTags);
    const tagMap: Record<string, FileEntity[]> = {};

    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .filter(
        (markdownFile: TFile) =>
          markdownFile !== activeFile &&
          !shouldExcludePath(markdownFile.path, this.settings.excludePaths)
      );

    for (const markdownFile of markdownFiles) {
      const cachedMetadata = this.app.metadataCache.getFileCache(markdownFile);
      if (!cachedMetadata) continue;

      const fileTags = this.getTagsFromCache(
        cachedMetadata,
        this.settings.excludeTags
      );

      for (const tag of fileTags) {
        if (!activeFileTagSet.has(tag)) continue;

        tagMap[tag] = tagMap[tag] ?? [];

        if (
          this.settings.enableDuplicateRemoval &&
          forwardLinkSet.has(filePathToLinkText(markdownFile.path))
        )
          continue;

        const linkText = filePathToLinkText(markdownFile.path);
        const newFileEntity = new FileEntity(activeFile.path, linkText);

        if (
          !tagMap[tag].some(
            (existingEntity) =>
              existingEntity.sourcePath === newFileEntity.sourcePath &&
              existingEntity.linkText === newFileEntity.linkText
          )
        ) {
          tagMap[tag].push(newFileEntity);
        }
      }
    }

    const tagLinksEntities = await this.createPropertiesLinkEntities(
      this.settings,
      tagMap,
      "tags"
    );

    const sortFunction = getTagHierarchySortFunction(this.settings.sortOrder);
    return tagLinksEntities.sort(sortFunction);
  }

  async getLinksListOfFilesWithFrontmatterKeys(
    activeFile: TFile,
    activeFileCache: CachedMetadata,
    forwardLinkSet: Set<string>,
    twoHopLinkSet: Set<string>
  ): Promise<PropertiesLinks[]> {
    const activeFileFrontmatter = activeFileCache.frontmatter;
    if (!activeFileFrontmatter) return [];

    const frontmatterKeyMap: Record<string, Record<string, FileEntity[]>> = {};
    const seen: Record<string, boolean> = {};

    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .filter(
        (markdownFile: TFile) =>
          markdownFile !== activeFile &&
          !shouldExcludePath(markdownFile.path, this.settings.excludePaths)
      );

    for (const markdownFile of markdownFiles) {
      const cachedMetadata = this.app.metadataCache.getFileCache(markdownFile);
      if (!cachedMetadata) continue;

      const fileFrontmatter = cachedMetadata.frontmatter;
      if (!fileFrontmatter) continue;

      for (const [key, value] of Object.entries(fileFrontmatter)) {
        if (!this.settings.frontmatterKeys.includes(key)) continue;

        let values: string[] = [];
        let activeValues: string[] = [];

        if (typeof value === "string") {
          values.push(value);
        } else if (Array.isArray(value)) {
          values.push(...value);
        } else {
          continue;
        }

        if (activeFileFrontmatter[key]) {
          if (typeof activeFileFrontmatter[key] === "string") {
            activeValues.push(activeFileFrontmatter[key]);
          } else if (Array.isArray(activeFileFrontmatter[key])) {
            activeValues.push(...activeFileFrontmatter[key]);
          } else {
            continue;
          }
        } else {
          continue;
        }

        for (const activeValue of activeValues) {
          const activeValueHierarchy = activeValue.split("/");
          for (let i = activeValueHierarchy.length - 1; i >= 0; i--) {
            const hierarchicalActiveValue = activeValueHierarchy
              .slice(0, i + 1)
              .join("/");

            for (const value of values) {
              if (typeof value !== "string") {
                continue;
              }
              const valueHierarchy = value.split("/");
              const hierarchicalValue = valueHierarchy
                .slice(0, i + 1)
                .join("/");

              if (hierarchicalActiveValue !== hierarchicalValue) continue;

              frontmatterKeyMap[key] = frontmatterKeyMap[key] ?? {};
              frontmatterKeyMap[key][hierarchicalValue] =
                frontmatterKeyMap[key][hierarchicalValue] ?? [];

              if (
                this.settings.enableDuplicateRemoval &&
                (seen[markdownFile.path] ||
                  forwardLinkSet.has(filePathToLinkText(markdownFile.path)) ||
                  twoHopLinkSet.has(filePathToLinkText(markdownFile.path)))
              ) {
                continue;
              }

              const linkText = filePathToLinkText(markdownFile.path);
              frontmatterKeyMap[key][hierarchicalValue].push(
                new FileEntity(activeFile.path, linkText)
              );
              seen[markdownFile.path] = true;
            }
          }
        }
      }
    }

    const frontmatterKeyLinksEntities: PropertiesLinks[] = [];

    for (const [key, valueMap] of Object.entries(frontmatterKeyMap)) {
      const propertiesLinksEntities = await this.createPropertiesLinkEntities(
        this.settings,
        valueMap,
        key
      );

      frontmatterKeyLinksEntities.push(...propertiesLinksEntities);
    }

    const sortFunction = getTagHierarchySortFunction(this.settings.sortOrder);
    return frontmatterKeyLinksEntities.sort(sortFunction);
  }

  async createPropertiesLinkEntities(
    settings: any,
    propertiesMap: Record<string, FileEntity[]>,
    key: string = ""
  ): Promise<PropertiesLinks[]> {
    const propertiesLinksEntitiesPromises = Object.entries(propertiesMap).map(
      async ([property, entities]) => {
        const sortedEntities = await this.getSortedFileEntities(
          entities,
          (entity) => entity.sourcePath,
          settings.sortOrder
        );
        if (sortedEntities.length === 0) {
          return null;
        }
        return new PropertiesLinks(property, key, sortedEntities);
      }
    );

    const propertiesLinksEntities = await Promise.all(
      propertiesLinksEntitiesPromises
    );
    return propertiesLinksEntities.filter((it) => it != null);
  }

  getTagsFromCache(
    cache: CachedMetadata | null | undefined,
    excludeTags: string[]
  ): string[] {
    const tags: string[] = [];
    const addTagWithHierarchy = (tag: string) => {
      tags.push(...expandTagHierarchy(tag));
    };

    if (cache) {
      if (cache.tags) {
        cache.tags.forEach((it) => {
          addTagWithHierarchy(it.tag);
        });
      }

      if (cache.frontmatter?.tags) {
        if (Array.isArray(cache.frontmatter.tags)) {
          cache.frontmatter.tags.forEach((tag) => {
            if (typeof tag === "string") {
              addTagWithHierarchy(tag);
            }
          });
        } else if (typeof cache.frontmatter.tags === "string") {
          cache.frontmatter.tags
            .split(",")
            .map((tag) => tag.trim())
            .forEach((tag) => {
              addTagWithHierarchy(tag);
            });
        }
      }
    }

    return tags.filter((tag) => {
      for (const excludeTag of excludeTags) {
        const normalizedExcludeTag = normalizeTagName(excludeTag);
        if (
          normalizedExcludeTag.endsWith("/") &&
          (tag === normalizedExcludeTag.slice(0, -1) ||
            tag.startsWith(normalizedExcludeTag))
        ) {
          return false;
        }
        if (
          !normalizedExcludeTag.endsWith("/") &&
          tag === normalizedExcludeTag
        ) {
          return false;
        }
      }
      return true;
    });
  }

  async getSortedFileEntities(
    entities: FileEntity[],
    sourcePathFn: (entity: FileEntity) => string | null | undefined,
    sortOrder: string
  ): Promise<FileEntity[]> {
    const statsPromises = entities.map(async (entity) => {
      const sourcePath = sourcePathFn(entity);
      if (!sourcePath) {
        return { entity, stat: null };
      }

      let stat = null;
      try {
        stat = await this.app.vault.adapter.stat(sourcePath);
      } catch (error) {
        console.debug(`Could not stat link entity: ${sourcePath}`, error);
      }
      return { entity, stat };
    });

    const stats = (await Promise.all(statsPromises)).filter((it) => it);

    const sortFunction = getSortFunction(sortOrder);
    stats.sort(sortFunction);

    return stats.map((it) => it!.entity);
  }
}
