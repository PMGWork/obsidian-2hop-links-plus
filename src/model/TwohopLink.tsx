import { FileEntity } from "./FileEntity";

export class TwohopLink {
  public link: FileEntity;
  public fileEntities: FileEntity[];
  public displayTitle?: string;
  public isHeaderClickable: boolean;

  constructor(
    link: FileEntity,
    fileEntities: FileEntity[],
    displayTitle?: string,
    isHeaderClickable: boolean = true
  ) {
    this.link = link;
    this.fileEntities = fileEntities;
    this.displayTitle = displayTitle;
    this.isHeaderClickable = isHeaderClickable;
  }
}
