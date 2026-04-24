import { TwohopLink } from "../model/TwohopLink";
import React, { createRef } from "react";
import { FileEntity } from "../model/FileEntity";
import TwohopLinksView from "./TwohopLinksView";
import ConnectedLinksView from "./ConnectedLinksView";
import { PropertiesLinks } from "../model/PropertiesLinks";
import { App, setIcon } from "obsidian";
import {
  formatDisplayTitle,
  formatTagDisplayTitle,
  normalizeTagName,
} from "../utils";

function mergeTwoHopLinks(
  twoHopLinks: TwohopLink[],
  tagLinksList: PropertiesLinks[],
  frontmatterKeyLinksList: PropertiesLinks[]
): TwohopLink[] {
  const mergedLinks: TwohopLink[] = [];
  const linkIndexByKey: Record<string, number> = {};

  const appendLink = (link: TwohopLink) => {
    const linkKey = link.link.key();
    const existingIndex = linkIndexByKey[linkKey];

    if (existingIndex == null) {
      linkIndexByKey[linkKey] = mergedLinks.length;
      mergedLinks.push(
        new TwohopLink(
          link.link,
          dedupeFileEntities(link.fileEntities),
          link.displayTitle,
          link.isHeaderClickable
        )
      );
      return;
    }

    mergedLinks[existingIndex] = new TwohopLink(
      mergedLinks[existingIndex].link,
      dedupeFileEntities([
        ...mergedLinks[existingIndex].fileEntities,
        ...link.fileEntities,
      ]),
      mergedLinks[existingIndex].displayTitle ?? link.displayTitle,
      mergedLinks[existingIndex].isHeaderClickable && link.isHeaderClickable
    );
  };

  twoHopLinks.forEach(appendLink);

  tagLinksList.forEach((tagLink) => {
    const sourcePath = tagLink.fileEntities[0]?.sourcePath ?? "";
    appendLink(
      new TwohopLink(
        new FileEntity(sourcePath, normalizeTagName(tagLink.property)),
        tagLink.fileEntities,
        formatTagDisplayTitle(tagLink.property),
        false
      )
    );
  });

  frontmatterKeyLinksList.forEach((propertyLink) => {
    const sourcePath = propertyLink.fileEntities[0]?.sourcePath ?? "";
    const title = propertyLink.key
      ? `${formatDisplayTitle(propertyLink.key)}: ${formatDisplayTitle(
          propertyLink.property
        )}`
      : formatDisplayTitle(propertyLink.property);

    appendLink(
      new TwohopLink(
        new FileEntity(sourcePath, formatDisplayTitle(propertyLink.property)),
        propertyLink.fileEntities,
        title,
        false
      )
    );
  });

  return mergedLinks;
}

function dedupeFileEntities(fileEntities: FileEntity[]): FileEntity[] {
  const seen: Record<string, boolean> = {};

  return fileEntities.filter((fileEntity) => {
    const key = fileEntity.key();
    if (seen[key]) return false;

    seen[key] = true;
    return true;
  });
}

interface TwohopLinksRootViewProps {
  forwardConnectedLinks: FileEntity[];
  newLinks: FileEntity[];
  backwardConnectedLinks: FileEntity[];
  twoHopLinks: TwohopLink[];
  tagLinksList: PropertiesLinks[];
  frontmatterKeyLinksList: PropertiesLinks[];
  onClick: (fileEntity: FileEntity) => Promise<void>;
  getPreview: (fileEntity: FileEntity) => Promise<string>;
  getTitle: (fileEntity: FileEntity) => Promise<string>;
  app: App;
  showForwardConnectedLinks: boolean;
  showBackwardConnectedLinks: boolean;
  showTwohopLinks: boolean;
  autoLoadTwoHopLinks: boolean;
  initialBoxCount: number;
  initialSectionCount: number;
}

type Category =
  | "forwardConnectedLinks"
  | "backwardConnectedLinks"
  | "twoHopLinks";

interface TwohopLinksRootViewState {
  displayedBoxCount: Record<Category, number>;
  displayedSectionCount: Record<Category, number>;
  prevProps: TwohopLinksRootViewProps | null;
  isLoaded: boolean;
}

export default class TwohopLinksRootView extends React.Component<
  TwohopLinksRootViewProps,
  TwohopLinksRootViewState
> {
  loadMoreRefs: Record<Category, React.RefObject<HTMLButtonElement>> = {
    forwardConnectedLinks: createRef(),
    backwardConnectedLinks: createRef(),
    twoHopLinks: createRef(),
  };

  constructor(props: TwohopLinksRootViewProps) {
    super(props);
    this.state = {
      displayedBoxCount: {
        forwardConnectedLinks: props.initialBoxCount,
        backwardConnectedLinks: props.initialBoxCount,
        twoHopLinks: props.initialBoxCount,
      },
      displayedSectionCount: {
        forwardConnectedLinks: props.initialSectionCount,
        backwardConnectedLinks: props.initialSectionCount,
        twoHopLinks: props.initialSectionCount,
      },
      prevProps: null,
      isLoaded: props.autoLoadTwoHopLinks,
    };
  }

  loadMoreBox = (category: Category) => {
    this.setState((prevState) => ({
      displayedBoxCount: {
        ...prevState.displayedBoxCount,
        [category]:
          prevState.displayedBoxCount[category] + this.props.initialBoxCount,
      },
      prevProps: this.props,
    }));
  };

  loadMoreSections = (category: Category) => {
    this.setState((prevState) => ({
      displayedSectionCount: {
        ...prevState.displayedSectionCount,
        [category]:
          prevState.displayedSectionCount[category] +
          this.props.initialSectionCount,
      },
      prevProps: this.props,
    }));
  };

  componentDidMount() {
    for (let ref of Object.values(this.loadMoreRefs)) {
      if (ref.current) {
        setIcon(ref.current, "more-horizontal");
      }
    }
  }

  componentDidUpdate(prevProps: TwohopLinksRootViewProps) {
    if (this.props !== prevProps) {
      this.setState({
        displayedBoxCount: {
          forwardConnectedLinks: this.props.initialBoxCount,
          backwardConnectedLinks: this.props.initialBoxCount,
          twoHopLinks: this.props.initialBoxCount,
        },
        displayedSectionCount: {
          forwardConnectedLinks: this.props.initialSectionCount,
          backwardConnectedLinks: this.props.initialSectionCount,
          twoHopLinks: this.props.initialSectionCount,
        },
        prevProps: this.props,
        isLoaded: this.props.autoLoadTwoHopLinks,
      });
    }
    for (let ref of Object.values(this.loadMoreRefs)) {
      if (ref.current) {
        setIcon(ref.current, "more-horizontal");
      }
    }
  }

  render(): JSX.Element {
    const {
      showForwardConnectedLinks,
      showBackwardConnectedLinks,
      showTwohopLinks,
      autoLoadTwoHopLinks,
    } = this.props;
    const { isLoaded } = this.state;
    const relatedTwoHopLinks = mergeTwoHopLinks(
      showTwohopLinks ? this.props.twoHopLinks : [],
      this.props.tagLinksList,
      this.props.frontmatterKeyLinksList
    );
    const newLinkKeys = new Set(this.props.newLinks.map((link) => link.key()));

    if (!autoLoadTwoHopLinks && !isLoaded) {
      return (
        <button
          className="load-more-button"
          onClick={() => this.setState({ isLoaded: true })}
        >
          Show 2hop links
        </button>
      );
    }

    return (
      <div>
        <button
          className="settings-button"
          onClick={() => {
            this.props.app.setting.open();
            this.props.app.setting.openTabById("2hop-links-plus");
          }}
        >
          Open Settings
        </button>
        {showForwardConnectedLinks && (
          <ConnectedLinksView
            fileEntities={this.props.forwardConnectedLinks}
            displayedBoxCount={
              this.state.displayedBoxCount.forwardConnectedLinks
            }
            onClick={this.props.onClick}
            getPreview={this.props.getPreview}
            getTitle={this.props.getTitle}
            onLoadMore={() => this.loadMoreBox("forwardConnectedLinks")}
            title={"Links"}
            className={"twohop-links-forward-links"}
            getLinkClassName={(fileEntity) =>
              newLinkKeys.has(fileEntity.key()) ? "twohop-links-new-link" : ""
            }
            app={this.props.app}
          />
        )}
        {showBackwardConnectedLinks && (
          <ConnectedLinksView
            fileEntities={this.props.backwardConnectedLinks}
            displayedBoxCount={
              this.state.displayedBoxCount.backwardConnectedLinks
            }
            onClick={this.props.onClick}
            getPreview={this.props.getPreview}
            getTitle={this.props.getTitle}
            onLoadMore={() => this.loadMoreBox("backwardConnectedLinks")}
            title={"Back Links"}
            className={"twohop-links-back-links"}
            app={this.props.app}
          />
        )}
        {relatedTwoHopLinks.length > 0 && (
          <TwohopLinksView
            twoHopLinks={relatedTwoHopLinks}
            onClick={this.props.onClick}
            getPreview={this.props.getPreview}
            getTitle={this.props.getTitle}
            app={this.props.app}
            displayedSectionCount={this.state.displayedSectionCount.twoHopLinks}
            initialDisplayedEntitiesCount={this.props.initialBoxCount}
            resetDisplayedEntitiesCount={this.props !== this.state.prevProps}
          />
        )}
        {this.state.displayedSectionCount.twoHopLinks <
          relatedTwoHopLinks.length && (
          <button
            ref={this.loadMoreRefs.twoHopLinks}
            className="load-more-button"
            onClick={() => this.loadMoreSections("twoHopLinks")}
          >
            Load more
          </button>
        )}
      </div>
    );
  }
}
