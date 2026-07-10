export function clearSubmittedText(current: string, submitted: string): string {
  return current === submitted ? "" : current;
}

export function clearSubmittedImages<T>(current: T[], submitted: T[]): T[] {
  const sent = new Set(submitted);
  return current.filter((image) => !sent.has(image));
}
