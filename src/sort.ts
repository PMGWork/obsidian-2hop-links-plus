import { TFile } from "obsidian";
import { PropertiesLinks } from "./model/PropertiesLinks";

export function getSortFunction(sortOrder: string) {
  switch (sortOrder) {
    case "random":
      return () => Math.random() - 0.5;
    case "filenameAsc":
      return (a: any, b: any) =>
        a.entity && b.entity
          ? a.entity.linkText.localeCompare(b.entity.linkText)
          : Math.random() - 0.5;
    case "filenameDesc":
      return (a: any, b: any) =>
        a.entity && b.entity
          ? b.entity.linkText.localeCompare(a.entity.linkText)
          : Math.random() - 0.5;
    case "modifiedDesc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.mtime && b.stat.mtime
          ? b.stat.mtime - a.stat.mtime
          : Math.random() - 0.5;
    case "modifiedAsc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.mtime && b.stat.mtime
          ? a.stat.mtime - b.stat.mtime
          : Math.random() - 0.5;
    case "createdDesc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.ctime && b.stat.ctime
          ? b.stat.ctime - a.stat.ctime
          : Math.random() - 0.5;
    case "createdAsc":
      return (a: any, b: any) =>
        a.stat && b.stat && a.stat.ctime && b.stat.ctime
          ? a.stat.ctime - b.stat.ctime
          : Math.random() - 0.5;
  }
}

export function getTwoHopSortFunction(sortOrder: string) {
  const compareByFilename = (a: any, b: any) =>
    a.twoHopLinkEntity && b.twoHopLinkEntity
      ? a.twoHopLinkEntity.link.linkText.localeCompare(
          b.twoHopLinkEntity.link.linkText
        )
      : Math.random() - 0.5;
  const compareByStat = (
    a: any,
    b: any,
    key: "mtime" | "ctime",
    desc: boolean
  ) => {
    const aValue = a.stat?.[key];
    const bValue = b.stat?.[key];
    if (aValue && bValue) {
      return desc ? bValue - aValue : aValue - bValue;
    }
    if (aValue && !bValue) {
      return -1;
    }
    if (!aValue && bValue) {
      return 1;
    }
    return compareByFilename(a, b);
  };

  switch (sortOrder) {
    case "random":
      return () => Math.random() - 0.5;
    case "filenameAsc":
      return compareByFilename;
    case "filenameDesc":
      return (a: any, b: any) =>
        a.twoHopLinkEntity && b.twoHopLinkEntity
          ? b.twoHopLinkEntity.link.linkText.localeCompare(
              a.twoHopLinkEntity.link.linkText
            )
          : Math.random() - 0.5;
    case "modifiedDesc":
      return (a: any, b: any) => compareByStat(a, b, "mtime", true);
    case "modifiedAsc":
      return (a: any, b: any) => compareByStat(a, b, "mtime", false);
    case "createdDesc":
      return (a: any, b: any) => compareByStat(a, b, "ctime", true);
    case "createdAsc":
      return (a: any, b: any) => compareByStat(a, b, "ctime", false);
  }
}

export function getSortFunctionForFile(sortOrder: string) {
  switch (sortOrder) {
    case "random":
      return () => Math.random() - 0.5;
    case "filenameAsc":
      return (file: TFile) => file.basename;
    case "filenameDesc":
      return (file: TFile) => -file.basename;
    case "modifiedDesc":
      return (file: TFile) => -file.stat.mtime;
    case "modifiedAsc":
      return (file: TFile) => file.stat.mtime;
    case "createdDesc":
      return (file: TFile) => -file.stat.ctime;
    case "createdAsc":
      return (file: TFile) => file.stat.ctime;
  }
}

export async function getSortedFiles(
  files: TFile[],
  sortFunction: (file: TFile) => string | number
): Promise<TFile[]> {
  const fileEntities: { file: TFile; sortValue: string | number }[] = files.map(
    (file) => {
      return { file, sortValue: sortFunction(file) };
    }
  );
  fileEntities.sort((a, b) => {
    const sortValueA = a.sortValue;
    const sortValueB = b.sortValue;
    if (typeof sortValueA === "string" && typeof sortValueB === "string") {
      return sortValueA.localeCompare(sortValueB);
    } else if (
      typeof sortValueA === "number" &&
      typeof sortValueB === "number"
    ) {
      return sortValueA - sortValueB;
    } else {
      return 0;
    }
  });
  return fileEntities.map((entity) => entity.file);
}

export function getTagHierarchySortFunction(sortOrder: string) {
  const sortFunction = getSortFunction(sortOrder);
  return (a: PropertiesLinks, b: PropertiesLinks) => {
    const aTagHierarchy = a.property.split("/");
    const bTagHierarchy = b.property.split("/");
    for (
      let i = 0;
      i < Math.min(aTagHierarchy.length, bTagHierarchy.length);
      i++
    ) {
      if (aTagHierarchy[i] !== bTagHierarchy[i]) {
        return sortFunction(aTagHierarchy[i], bTagHierarchy[i]);
      }
    }
    if (aTagHierarchy.length !== bTagHierarchy.length) {
      return aTagHierarchy.length > bTagHierarchy.length ? -1 : 1;
    }
    return sortFunction(a.property, b.property);
  };
}
