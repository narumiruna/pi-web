export function getPastedImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (itemFiles.length > 0) return dedupeFiles(itemFiles);

  return dedupeFiles(
    Array.from(clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    ),
  );
}

function dedupeFiles(files: File[]): File[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}:${file.size}:${file.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
