import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import { FileEntity } from "./model/FileEntity";
import { TwohopLink } from "./model/TwohopLink";
import TwohopLinksRootView from "./ui/TwohopLinksRootView";
import { PropertiesLinks } from "./model/PropertiesLinks";
import { normalizeLinkTarget } from "./utils";
import {
  TwohopPluginSettings,
  TwohopSettingTab,
} from "./settings/TwohopSettingTab";
import { SeparatePaneView } from "./ui/SeparatePaneView";
import { readPreview } from "./preview";
import { getTitle } from "./getTitle";
import { loadSettings } from "./settings/index";
import { Links } from "./links";
import { getTwohopMetadataSignature } from "./metadataSignature";

const CONTAINER_CLASS = "twohop-links-container";
export const HOVER_LINK_ID = "2hop-links";

export default class TwohopLinksPlugin extends Plugin {
  settings: TwohopPluginSettings;
  showLinksInMarkdown: boolean;
  links: Links;

  private previousMetadataSignature = "";
  private renderDebounceTimer: number | null = null;
  private previewCache: Record<string, string> = {};
  private titleCache: Record<string, string> = {};

  async onload(): Promise<void> {
    console.debug("------ loading obsidian-twohop-links plugin");

    this.settings = await loadSettings(this);
    this.showLinksInMarkdown = true;
    this.links = new Links(this.app, this.settings);

    this.initPlugin();
  }

  async initPlugin() {
    this.addSettingTab(new TwohopSettingTab(this.app, this));
    this.registerView(
      "TwoHopLinksView",
      (leaf: WorkspaceLeaf) => new SeparatePaneView(leaf, this, this.links)
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", async (_file: TFile) => {
        this.clearLinkTextCache();
        this.scheduleRenderTwohopLinks();
      })
    );
    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        this.refreshTwohopLinks.bind(this)
      )
    );
    this.app.workspace.trigger("parse-style-settings");

    this.addCommand({
      id: "debug-twohop-links",
      name: "Debug 2Hop Links",
      callback: async () => {
        await this.debugTwohopLinks();
      },
    });

    await this.renderTwohopLinks(true);
  }

  onunload(): void {
    if (this.renderDebounceTimer != null) {
      window.clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
    this.disableLinksInMarkdown();
    console.log("unloading plugin");
  }

  async refreshTwohopLinks() {
    if (this.showLinksInMarkdown) {
      this.clearLinkTextCache();
      await this.renderTwohopLinks(true);
    }
  }

  clearLinkTextCache(): void {
    this.previewCache = {};
    this.titleCache = {};
  }

  private scheduleRenderTwohopLinks(): void {
    if (this.renderDebounceTimer != null) {
      window.clearTimeout(this.renderDebounceTimer);
    }

    this.renderDebounceTimer = window.setTimeout(async () => {
      this.renderDebounceTimer = null;
      if (this.showLinksInMarkdown) {
        await this.renderTwohopLinks(false);
      }
    }, 150);
  }

  private getLinkCacheKey(fileEntity: FileEntity): string {
    return `${fileEntity.sourcePath}\u001f${normalizeLinkTarget(
      fileEntity.linkText
    )}`;
  }

  private async getCachedPreview(
    fileEntity: FileEntity,
    signal: AbortSignal
  ): Promise<string> {
    const key = this.getLinkCacheKey(fileEntity);
    if (this.previewCache[key] != null) {
      return this.previewCache[key];
    }

    const preview = await readPreview.call(this, fileEntity, signal);
    if (!signal.aborted) {
      this.previewCache[key] = preview;
    }
    return preview;
  }

  private async getCachedTitle(
    fileEntity: FileEntity,
    signal: AbortSignal
  ): Promise<string> {
    const key = this.getLinkCacheKey(fileEntity);
    if (this.titleCache[key] != null) {
      return this.titleCache[key];
    }

    const title = await getTitle.call(this, fileEntity, signal);
    if (!signal.aborted) {
      this.titleCache[key] = title;
    }
    return title;
  }

  private async debugTwohopLinks(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("2Hop Links Plus: active file not found");
      return;
    }

    const snapshot = await this.links.getDebugSnapshot(activeFile);
    console.log("2Hop Links Plus debug snapshot", snapshot);
    new Notice("2Hop Links Plus: debug snapshot printed to console");
  }

  private async openFile(fileEntity: FileEntity): Promise<void> {
    const linkText = normalizeLinkTarget(fileEntity.linkText);

    console.debug(
      `Open file: linkText='${linkText}', sourcePath='${fileEntity.sourcePath}'`
    );
    const file = this.app.metadataCache.getFirstLinkpathDest(
      linkText,
      fileEntity.sourcePath
    );
    if (file == null) {
      if (!confirm(`Create new file: ${linkText}?`)) {
        console.log("Canceled!!");
        return;
      }
    }
    return this.app.workspace.openLinkText(
      fileEntity.linkText,
      fileEntity.sourcePath
    );
  }

  async updateTwoHopLinksView() {
    this.clearLinkTextCache();
    if (this.isTwoHopLinksViewOpen()) {
      this.app.workspace.detachLeavesOfType("TwoHopLinksView");
    }
    if (this.settings.showTwoHopLinksInSeparatePane) {
      this.openTwoHopLinksView();
      this.disableLinksInMarkdown();
      this.removePaddingBottom();
    } else {
      this.enableLinksInMarkdown();
    }
  }

  isTwoHopLinksViewOpen(): boolean {
    return this.app.workspace.getLeavesOfType("TwoHopLinksView").length > 0;
  }

  async openTwoHopLinksView() {
    const leaf = this.settings.panePositionIsRight
      ? this.app.workspace.getRightLeaf(false)
      : this.app.workspace.getLeftLeaf(false);
    leaf.setViewState({ type: "TwoHopLinksView" });
    this.app.workspace.revealLeaf(leaf);
  }

  private getContainerElements(markdownView: MarkdownView): Element[] {
    const elements = markdownView.containerEl.querySelectorAll(
      ".markdown-source-view .CodeMirror-lines, .markdown-preview-view, .markdown-source-view .cm-sizer"
    );

    const containers: Element[] = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements.item(i);
      const container =
        el.querySelector("." + CONTAINER_CLASS) ||
        el.createDiv({ cls: CONTAINER_CLASS });
      containers.push(container);
    }

    return containers;
  }

  async renderTwohopLinks(isForceUpdate: boolean): Promise<void> {
    if (this.settings.showTwoHopLinksInSeparatePane) {
      return;
    }
    this.addPaddingBottom();
    const markdownView: MarkdownView =
      this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = markdownView?.file;
    if (!activeFile) {
      return;
    }

    const currentMetadataSignature = getTwohopMetadataSignature(
      this.app,
      activeFile,
      this.settings
    );

    if (
      isForceUpdate ||
      this.previousMetadataSignature !== currentMetadataSignature
    ) {
      const {
        forwardLinks,
        newLinks,
        backwardLinks,
        twoHopLinks,
        tagLinksList,
        frontmatterKeyLinksList,
      } = await this.links.gatherTwoHopLinks(activeFile);

      for (const container of this.getContainerElements(markdownView)) {
        ReactDOM.unmountComponentAtNode(container);
        await this.injectTwohopLinks(
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList,
          container
        );
      }

      this.previousMetadataSignature = currentMetadataSignature;
    }
  }

  async injectTwohopLinks(
    forwardConnectedLinks: FileEntity[],
    newLinks: FileEntity[],
    backwardConnectedLinks: FileEntity[],
    twoHopLinks: TwohopLink[],
    tagLinksList: PropertiesLinks[],
    frontmatterKeyLinksList: PropertiesLinks[],
    container: Element
  ) {
    const showForwardConnectedLinks = this.settings.showForwardConnectedLinks;
    const showBackwardConnectedLinks = this.settings.showBackwardConnectedLinks;
    const showTwohopLinks = this.settings.showTwohopLinks;
    ReactDOM.render(
      <TwohopLinksRootView
        forwardConnectedLinks={forwardConnectedLinks}
        newLinks={newLinks}
        backwardConnectedLinks={backwardConnectedLinks}
        twoHopLinks={twoHopLinks}
        tagLinksList={tagLinksList}
        frontmatterKeyLinksList={frontmatterKeyLinksList}
        onClick={this.openFile.bind(this)}
        getPreview={this.getCachedPreview.bind(this)}
        getTitle={this.getCachedTitle.bind(this)}
        app={this.app}
        showForwardConnectedLinks={showForwardConnectedLinks}
        showBackwardConnectedLinks={showBackwardConnectedLinks}
        showTwohopLinks={showTwohopLinks}
        autoLoadTwoHopLinks={this.settings.autoLoadTwoHopLinks}
        initialBoxCount={this.settings.initialBoxCount}
        initialSectionCount={this.settings.initialSectionCount}
      />,
      container
    );
  }

  enableLinksInMarkdown(): void {
    this.showLinksInMarkdown = true;
    this.renderTwohopLinks(true).then(() =>
      console.debug("Rendered two hop links")
    );
  }

  disableLinksInMarkdown(): void {
    this.showLinksInMarkdown = false;
    this.removeTwohopLinks();
    const container = this.app.workspace.containerEl.querySelector(
      ".twohop-links-container"
    );
    if (container) {
      ReactDOM.unmountComponentAtNode(container);
      container.remove();
    }
    (this.app.workspace as any).unregisterHoverLinkSource(HOVER_LINK_ID);
  }

  removeTwohopLinks(): void {
    const markdownView: MarkdownView =
      this.app.workspace.getActiveViewOfType(MarkdownView);

    if (markdownView !== null) {
      for (const element of this.getContainerElements(markdownView)) {
        const container = element.querySelector("." + CONTAINER_CLASS);
        if (container) {
          container.remove();
        }
      }

      if (markdownView.previewMode !== null) {
        const previewElements = Array.from(
          markdownView.previewMode.containerEl.querySelectorAll(
            "." + CONTAINER_CLASS
          )
        );
        for (const element of previewElements) {
          element.remove();
        }
      }
    }
  }

  addPaddingBottom(): void {
    if (!document.getElementById("twohop-custom-padding")) {
      const styleEl = document.createElement("style");
      styleEl.id = "twohop-custom-padding";
      styleEl.innerText = `
      .markdown-preview-section,
      .cm-content {
        padding-bottom: 20px !important;
      }
    `;
      document.head.appendChild(styleEl);
    }
  }

  removePaddingBottom(): void {
    const existingStyleEl = document.getElementById("twohop-custom-padding");
    if (existingStyleEl) {
      existingStyleEl.parentNode.removeChild(existingStyleEl);
    }
  }
}
