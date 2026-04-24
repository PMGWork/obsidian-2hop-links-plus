import React from "react";
import { FileEntity } from "../model/FileEntity";
import { isImagePath, normalizeLinkTarget } from "../utils";
import {
  App,
  Menu,
  HoverParent,
  HoverPopover,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { HOVER_LINK_ID } from "../main";

interface LinkViewProps {
  fileEntity: FileEntity;
  className?: string;
  onClick: (fileEntity: FileEntity) => Promise<void>;
  getPreview: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  getTitle: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  app: App;
}

interface LinkViewState {
  preview: string;
  title: string;
  thumbnailSrc: string;
  mouseDown: boolean;
  dragging: boolean;
  touchStart: number;
}

export default class LinkView
  extends React.Component<LinkViewProps, LinkViewState>
  implements HoverParent
{
  private abortController: AbortController;
  hoverPopover: HoverPopover | null;
  isMobile: boolean;

  constructor(props: LinkViewProps) {
    super(props);
    this.state = {
      preview: null,
      title: null,
      thumbnailSrc: null,
      mouseDown: false,
      dragging: false,
      touchStart: 0,
    };
    this.isMobile = window.matchMedia("(pointer: coarse)").matches;
  }

  async componentDidMount(): Promise<void> {
    this.abortController = new AbortController();
    const preview = await this.props.getPreview(
      this.props.fileEntity,
      this.abortController.signal
    );
    const title = await this.props.getTitle(
      this.props.fileEntity,
      this.abortController.signal
    );
    const thumbnailSrc = await this.getThumbnailSrc(preview);
    if (!this.abortController.signal.aborted) {
      this.setState({
        preview: preview,
        title: title,
        thumbnailSrc: thumbnailSrc,
      });
    }
  }

  componentWillUnmount() {
    this.abortController.abort();
  }

  async openFileWithOptions(options?: "tab" | "split" | "window") {
    const { app, fileEntity } = this.props;
    const file = this.getLinkedFile();
    if (!file) {
      await this.props.onClick(fileEntity);
      return;
    }
    let leaf: WorkspaceLeaf;
    leaf = app.workspace.getLeaf(options);

    await leaf.openFile(file);
  }

  handleContextMenu = (event: React.MouseEvent | React.TouchEvent) => {
    if ("button" in event && event.button !== 2) return;
    event.preventDefault();

    const clientX =
      "changedTouches" in event
        ? event.changedTouches[0].clientX
        : event.clientX;
    const clientY =
      "changedTouches" in event
        ? event.changedTouches[0].clientY
        : event.clientY;

    const menu = new Menu();

    menu.addItem((item) =>
      item.setTitle("Open link").onClick(async () => {
        await this.openFileWithOptions();
      })
    );

    menu.addItem((item) =>
      item.setTitle("Open in new tab").onClick(async () => {
        await this.openFileWithOptions("tab");
      })
    );

    menu.addItem((item) =>
      item.setTitle("Open to the right").onClick(async () => {
        await this.openFileWithOptions("split");
      })
    );

    menu.addItem((item) =>
      item.setTitle("Open in new window").onClick(async () => {
        await this.openFileWithOptions("window");
      })
    );

    menu.showAtPosition({ x: clientX, y: clientY });
  };

  onMouseOver = (e: React.MouseEvent) => {
    const targetEl = e.currentTarget as HTMLElement;

    if (targetEl.tagName !== "DIV") return;

    this.props.app.workspace.trigger("hover-link", {
      event: e.nativeEvent,
      source: HOVER_LINK_ID,
      hoverParent: this,
      targetEl,
      linktext: this.props.fileEntity.linkText,
      sourcePath: this.props.fileEntity.sourcePath,
    });
  };

  onMouseUpOrTouchEnd = async (event: React.MouseEvent | React.TouchEvent) => {
    const longPress = Date.now() - this.state.touchStart >= 500;
    if (longPress && !this.state.dragging) {
      this.handleContextMenu(event);
    } else if (!this.state.dragging) {
      await this.props.onClick(this.props.fileEntity);
    }
    this.setState({ touchStart: 0, dragging: false });
  };

  render(): JSX.Element {
    const className = ["twohop-links-box", this.props.className]
      .filter(Boolean)
      .join(" ");
    const imageSrc = this.getImageSrc() ?? this.state.thumbnailSrc;

    return (
      <div
        className={className}
        onTouchStart={() => {
          this.setState({ touchStart: Date.now() });
        }}
        onTouchMove={() => {
          if (Date.now() - this.state.touchStart < 200) {
            this.setState({ dragging: true });
          }
        }}
        onTouchEnd={this.onMouseUpOrTouchEnd}
        onTouchCancel={() => {
          this.setState({ touchStart: 0, dragging: false });
        }}
        onMouseDown={(event) => {
          if (this.isMobile) return;
          if (event.button === 0) {
            this.setState({ mouseDown: true });
          }
        }}
        onMouseUp={(event) => {
          if (this.isMobile) return;
          if (event.button === 1) {
            this.openFileWithOptions("tab");
          } else if (event.button === 0 && !this.state.dragging) {
            this.props.onClick(this.props.fileEntity);
          }
          this.setState({ mouseDown: false, dragging: false });
        }}
        onContextMenu={this.handleContextMenu}
        onMouseOver={this.onMouseOver}
        draggable="true"
        onDragStart={(event) => {
          const fileEntityLinkText = normalizeLinkTarget(
            this.props.fileEntity.linkText
          );
          event.dataTransfer.setData("text/plain", `[[${fileEntityLinkText}]]`);
        }}
      >
        <div className="twohop-links-box-title">{this.state.title}</div>
        <div className={"twohop-links-box-preview"}>
          {imageSrc ? (
            <img src={imageSrc} alt={this.state.title ?? ""} />
          ) : (
            <div>{this.state.preview}</div>
          )}
        </div>
      </div>
    );
  }

  private getImageSrc(): string | null {
    return this.getImageSrcForLink(
      this.props.fileEntity.linkText,
      this.props.fileEntity.sourcePath
    );
  }

  private async getThumbnailSrc(preview: string): Promise<string | null> {
    const linkedFile = this.getLinkedFile();
    if (!linkedFile || !linkedFile.extension?.match(/^(md|markdown)$/)) {
      return null;
    }

    const frontmatterImageSrc = this.getFrontmatterImageSrc(linkedFile);
    if (frontmatterImageSrc) {
      return frontmatterImageSrc;
    }

    const cache = this.props.app.metadataCache.getFileCache(linkedFile);
    const embedImageSrc = (cache?.embeds ?? [])
      .map((embed) => this.getImageSrcForLink(embed.link, linkedFile.path))
      .find((src) => src != null);
    if (embedImageSrc) {
      return embedImageSrc;
    }

    const content = await this.props.app.vault.cachedRead(linkedFile);
    return (
      this.getFirstImageSrcFromContent(content, linkedFile.path) ??
      this.getFirstImageSrcFromContent(preview, linkedFile.path)
    );
  }

  private getLinkedFile(): TFile | null {
    const normalizedLinkText = normalizeLinkTarget(
      this.props.fileEntity.linkText
    );
    const linkedFile = this.props.app.metadataCache.getFirstLinkpathDest(
      normalizedLinkText,
      this.props.fileEntity.sourcePath
    );

    if (linkedFile) {
      return linkedFile;
    }

    const sourceFile = this.props.app.vault.getAbstractFileByPath(
      this.props.fileEntity.sourcePath
    );
    if (sourceFile instanceof TFile && sourceFile.path === normalizedLinkText) {
      return sourceFile;
    }
    if (sourceFile instanceof TFile && isImagePath(sourceFile.path)) {
      return sourceFile;
    }

    const directFile =
      this.props.app.vault.getAbstractFileByPath(normalizedLinkText);
    return directFile instanceof TFile ? directFile : null;
  }

  private getFrontmatterImageSrc(file: TFile): string | null {
    const frontmatter =
      this.props.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) {
      return null;
    }

    for (const key of ["image", "cover", "thumbnail"]) {
      const values = this.toStringValues(frontmatter[key]);
      for (const value of values) {
        const imageSrc = this.getImageSrcForLink(value, file.path);
        if (imageSrc) {
          return imageSrc;
        }
      }
    }

    return null;
  }

  private getFirstImageSrcFromContent(
    content: string,
    sourcePath: string
  ): string | null {
    const wikilinkPattern = /!\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikilinkPattern.exec(content)) != null) {
      const imageSrc = this.getImageSrcForLink(match[1], sourcePath);
      if (imageSrc) {
        return imageSrc;
      }
    }

    const markdownImagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
    while ((match = markdownImagePattern.exec(content)) != null) {
      const imageSrc = this.getImageSrcForLink(match[1], sourcePath);
      if (imageSrc) {
        return imageSrc;
      }
    }

    return null;
  }

  private getImageSrcForLink(
    linkText: string,
    sourcePath: string
  ): string | null {
    const imageTarget = this.extractImageTarget(linkText);
    if (!imageTarget) {
      return null;
    }

    if (/^https?:\/\//i.test(imageTarget)) {
      return imageTarget;
    }

    if (!isImagePath(imageTarget)) {
      return null;
    }

    const normalizedImageTarget = normalizeLinkTarget(imageTarget);
    const linkedFile = this.props.app.metadataCache.getFirstLinkpathDest(
      normalizedImageTarget,
      sourcePath
    );
    if (linkedFile) {
      return this.props.app.vault.getResourcePath(linkedFile);
    }

    const directFile = this.props.app.vault.getAbstractFileByPath(
      normalizedImageTarget
    );
    if (directFile instanceof TFile) {
      return this.props.app.vault.getResourcePath(directFile);
    }

    const sourceFile = this.props.app.vault.getAbstractFileByPath(sourcePath);
    if (sourceFile instanceof TFile && sourceFile.parent) {
      const relativeFile = this.props.app.vault.getAbstractFileByPath(
        `${sourceFile.parent.path}/${normalizedImageTarget}`
      );
      if (relativeFile instanceof TFile) {
        return this.props.app.vault.getResourcePath(relativeFile);
      }
    }

    const normalizedImageTargetLower = normalizedImageTarget.toLowerCase();
    const basenameFile = this.props.app.vault
      .getFiles()
      .find(
        (file) =>
          isImagePath(file.path) &&
          (file.name.toLowerCase() === normalizedImageTargetLower ||
            file.path.toLowerCase().endsWith(`/${normalizedImageTargetLower}`))
      );

    return basenameFile
      ? this.props.app.vault.getResourcePath(basenameFile)
      : null;
  }

  private extractImageTarget(linkText: string): string | null {
    const trimmedLinkText = linkText.trim().replace(/^['"<]+|['">]+$/g, "");
    const wikilinkMatch = trimmedLinkText.match(/^!?\[\[([^\]]+)\]\]$/);
    if (wikilinkMatch) {
      return wikilinkMatch[1];
    }

    const markdownImageMatch = trimmedLinkText.match(
      /^!\[[^\]]*\]\(([^)]+)\)$/
    );
    if (markdownImageMatch) {
      return markdownImageMatch[1]
        .trim()
        .replace(/\s+["'][^"']*["']$/, "")
        .replace(/^['"<]+|['">]+$/g, "");
    }

    return trimmedLinkText;
  }

  private toStringValues(value: unknown): string[] {
    if (value == null) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.reduce<string[]>(
        (values, item: unknown) => values.concat(this.toStringValues(item)),
        []
      );
    }

    return typeof value === "string" ? [value] : [];
  }
}
