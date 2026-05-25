export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif", "tiff", "tif",
]);

export function isImageFile(fileId: string): boolean {
  const ext = fileId.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

export function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    html: "html",
    css: "css",
    scss: "css",
    md: "markdown",
    json: "json",
    txt: "plaintext",
  };
  return map[ext] || "plaintext";
}

export function getMonacoLanguage(lang: string): string {
  const map: Record<string, string> = {
    python: "python",
    typescript: "typescript",
    javascript: "javascript",
    html: "html",
    css: "css",
    markdown: "markdown",
    json: "json",
    plaintext: "plaintext",
  };
  return map[lang] || "plaintext";
}
