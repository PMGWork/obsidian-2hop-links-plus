import { TFile, WorkspaceLeaf, ItemView } from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import TwohopLinksPlugin from "../main";
import { Links } from "../links";
import { getTwohopMetadataSignature } from "../metadataSignature";

export class SeparatePaneView extends ItemView {
  private plugin: TwohopLinksPlugin;
  private lastActiveLeaf: WorkspaceLeaf | undefined;
  private previousMetadataSignature = "";
  private updateDebounceTimer: number | null = null;
  links: Links;

  constructor(leaf: WorkspaceLeaf, plugin: TwohopLinksPlugin, links: Links) {
    super(leaf);
    this.plugin = plugin;
    this.containerEl.addClass("TwoHopLinks");
    this.links = links;
  }

  getViewType(): string {
    return "TwoHopLinksView";
  }

  getDisplayText(): string {
    return "2Hop Links";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    try {
      this.lastActiveLeaf = this.app.workspace.getLeaf();
      await this.updateOrForceUpdate(true);

      this.registerActiveFileUpdateEvent();

      this.registerEvent(
        this.app.metadataCache.on("changed", async (_file: TFile) => {
          this.plugin.clearLinkTextCache();
          this.scheduleUpdate();
        })
      );
    } catch (error) {
      this.handleError("Error updating TwoHopLinksView", error);
    }
  }

  async onClose(): Promise<void> {
    if (this.updateDebounceTimer != null) {
      window.clearTimeout(this.updateDebounceTimer);
      this.updateDebounceTimer = null;
    }
  }

  scheduleUpdate(): void {
    if (this.updateDebounceTimer != null) {
      window.clearTimeout(this.updateDebounceTimer);
      this.updateDebounceTimer = null;
    }

    void this.updateOrForceUpdate(false);
  }

  async updateOrForceUpdate(isForceUpdate: boolean): Promise<void> {
    try {
      const activeFile = this.app.workspace.getActiveFile();
      const currentMetadataSignature = getTwohopMetadataSignature(
        this.app,
        activeFile,
        this.plugin.settings
      );

      if (
        isForceUpdate ||
        this.previousMetadataSignature !== currentMetadataSignature ||
        activeFile === null
      ) {
        const {
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList,
        } = await this.links.gatherTwoHopLinks(activeFile);

        ReactDOM.unmountComponentAtNode(this.containerEl);
        await this.plugin.injectTwohopLinks(
          forwardLinks,
          newLinks,
          backwardLinks,
          twoHopLinks,
          tagLinksList,
          frontmatterKeyLinksList,
          this.containerEl
        );

        this.addLinkEventListeners();

        this.previousMetadataSignature = currentMetadataSignature;
      }
    } catch (error) {
      this.handleError("Error rendering two hop links", error);
    }
  }

  handleError(message: string, error: any): void {
    console.error(message, error);
    ReactDOM.unmountComponentAtNode(this.containerEl);
    ReactDOM.render(
      <div>Error: Could not render two hop links</div>,
      this.containerEl
    );
  }

  registerActiveFileUpdateEvent() {
    let lastActiveFilePath: string | null = null;

    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        async (leaf: WorkspaceLeaf) => {
          if (leaf.view === this) {
            return;
          }

          const newActiveFile = (leaf.view as any).file as TFile;
          const newActiveFilePath = newActiveFile ? newActiveFile.path : null;

          if (
            lastActiveFilePath !== newActiveFilePath ||
            newActiveFilePath === null
          ) {
            this.lastActiveLeaf = leaf;
            lastActiveFilePath = newActiveFilePath;
            this.plugin.clearLinkTextCache();
            await this.updateOrForceUpdate(true);
          }
        }
      )
    );
  }

  addLinkEventListeners(): void {
    const links = this.containerEl.querySelectorAll("a");
    links.forEach((link) => {
      link.addEventListener("click", async (event) => {
        event.preventDefault();

        const filePath = link.getAttribute("href");
        if (!filePath) {
          console.error("Link does not have href attribute", link);
          return;
        }

        const fileOrFolder = this.app.vault.getAbstractFileByPath(filePath);
        if (!fileOrFolder || !(fileOrFolder instanceof TFile)) {
          console.error("No file found for path", filePath);
          return;
        }
        const file = fileOrFolder as TFile;

        if (!this.lastActiveLeaf) {
          console.error("No last active leaf");
          return;
        }

        await this.lastActiveLeaf.openFile(file);
      });
    });
  }
}
