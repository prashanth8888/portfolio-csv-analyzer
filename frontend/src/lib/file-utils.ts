const MAX_FILES = 10;
const allowedExtensions = new Set(["csv", "pdf"]);

export interface FileSelectionResult {
  files: File[];
  limitExceeded: boolean;
  rejectedNames: string[];
}

function getExtension(fileName: string): string {
  const segments = fileName.split(".");
  return segments.length > 1 ? segments.at(-1)!.toLowerCase() : "";
}

function getFileId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function selectFiles(existingFiles: File[], incomingFiles: Iterable<File>): FileSelectionResult {
  const nextFiles = [...existingFiles];
  const seenIds = new Set(existingFiles.map(getFileId));
  const rejectedNames: string[] = [];
  let limitExceeded = false;

  for (const file of incomingFiles) {
    const extension = getExtension(file.name);

    if (!allowedExtensions.has(extension)) {
      rejectedNames.push(file.name);
      continue;
    }

    const id = getFileId(file);
    if (seenIds.has(id)) {
      continue;
    }

    if (nextFiles.length >= MAX_FILES) {
      limitExceeded = true;
      break;
    }

    seenIds.add(id);
    nextFiles.push(file);
  }

  return { files: nextFiles, limitExceeded, rejectedNames };
}

export function canAnalyzeFiles(files: File[]): boolean {
  return files.length > 0 && files.length <= MAX_FILES;
}

export function getFileKindLabel(fileName: string): "CSV" | "PDF" | "File" {
  const extension = getExtension(fileName);

  if (extension === "csv") {
    return "CSV";
  }

  if (extension === "pdf") {
    return "PDF";
  }

  return "File";
}

export { MAX_FILES };
