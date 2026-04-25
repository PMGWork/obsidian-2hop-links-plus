import React, { createRef } from "react";
import { FileEntity } from "../model/FileEntity";
import LinkView from "./LinkView";
import { TwohopLink } from "../model/TwohopLink";
import { App, setIcon } from "obsidian";

interface TwohopLinksViewProps {
  twoHopLinks: TwohopLink[];
  onClick: (fileEntity: FileEntity) => Promise<void>;
  getPreview: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  getTitle: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  app: App;
  displayedSectionCount: number;
  initialDisplayedEntitiesCount: number;
  resetDisplayedEntitiesCount: boolean;
}

interface LinkComponentProps {
  link: TwohopLink;
  onClick: (fileEntity: FileEntity) => Promise<void>;
  getPreview: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  getTitle: (fileEntity: FileEntity, signal: AbortSignal) => Promise<string>;
  app: App;
  initialDisplayedEntitiesCount: number;
  resetDisplayedEntitiesCount: boolean;
}

interface LinkComponentState {
  displayedEntitiesCount: number;
  title: string;
}

class LinkComponent extends React.Component<
  LinkComponentProps,
  LinkComponentState
> {
  loadMoreRef = createRef<HTMLDivElement>();
  private titleAbortController: AbortController | null = null;

  constructor(props: LinkComponentProps) {
    super(props);
    this.state = {
      displayedEntitiesCount: props.initialDisplayedEntitiesCount,
      title: null,
    };
  }

  async componentDidMount() {
    if (this.loadMoreRef.current) {
      setIcon(this.loadMoreRef.current, "more-horizontal");
    }

    await this.updateTitle();
  }

  async updateTitle() {
    if (this.titleAbortController) {
      this.titleAbortController.abort();
    }
    this.titleAbortController = new AbortController();
    const title =
      this.props.link.displayTitle ??
      (await this.props.getTitle(
        this.props.link.link,
        this.titleAbortController.signal
      ));

    if (this.titleAbortController.signal.aborted) {
      return;
    }

    this.setState({
      title: title,
    });
  }

  componentWillUnmount() {
    if (this.titleAbortController) {
      this.titleAbortController.abort();
    }
  }

  async componentDidUpdate(prevProps: LinkComponentProps) {
    if (
      this.props.resetDisplayedEntitiesCount &&
      this.props.resetDisplayedEntitiesCount !==
        prevProps.resetDisplayedEntitiesCount
    ) {
      this.setState({
        displayedEntitiesCount: this.props.initialDisplayedEntitiesCount,
      });
    }

    if (
      this.props.link.link.key() !== prevProps.link.link.key() ||
      this.props.link.displayTitle !== prevProps.link.displayTitle
    ) {
      await this.updateTitle();
    }

    if (this.loadMoreRef.current) {
      setIcon(this.loadMoreRef.current, "more-horizontal");
    }
  }

  loadMoreEntities = () => {
    this.setState((prevState) => ({
      displayedEntitiesCount:
        prevState.displayedEntitiesCount +
        this.props.initialDisplayedEntitiesCount,
    }));
  };

  render(): JSX.Element {
    const headerClassName =
      "twohop-links-twohop-header twohop-links-header-card twohop-links-box" +
      (this.props.link.isHeaderClickable ? "" : " twohop-links-label-header");

    return (
      <div
        className={"twohop-links-section " + "twohop-links-resolved"}
        key={this.props.link.link.linkText}
      >
        <div
          className={headerClassName}
          onClick={async () => {
            if (this.props.link.isHeaderClickable) {
              await this.props.onClick(this.props.link.link);
            }
          }}
          onMouseDown={async (event) => {
            if (event.button == 0 && this.props.link.isHeaderClickable) {
              await this.props.onClick(this.props.link.link);
            }
          }}
        >
          {this.state.title}
        </div>
        {this.props.link.fileEntities
          .slice(0, this.state.displayedEntitiesCount)
          .map((it) => (
            <LinkView
              fileEntity={it}
              key={this.props.link.link.linkText + it.key()}
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              app={this.props.app}
            />
          ))}
        {this.props.link.fileEntities.length >
          this.state.displayedEntitiesCount && (
          <div
            ref={this.loadMoreRef}
            onClick={this.loadMoreEntities}
            className="load-more-button twohop-links-box"
          ></div>
        )}
      </div>
    );
  }
}

const MemoizedLinkComponent = React.memo(LinkComponent);

class TwohopLinksView extends React.Component<TwohopLinksViewProps> {
  render(): JSX.Element {
    return (
      <div>
        {this.props.twoHopLinks
          .slice(0, this.props.displayedSectionCount)
          .map((link) => (
            <MemoizedLinkComponent
              key={link.link.key()}
              link={link}
              onClick={this.props.onClick}
              getPreview={this.props.getPreview}
              getTitle={this.props.getTitle}
              app={this.props.app}
              initialDisplayedEntitiesCount={
                this.props.initialDisplayedEntitiesCount
              }
              resetDisplayedEntitiesCount={
                this.props.resetDisplayedEntitiesCount
              }
            />
          ))}
      </div>
    );
  }
}

export default React.memo(TwohopLinksView);
