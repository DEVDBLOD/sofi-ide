"use client";

import {
  FileCode2, FileText, File, Settings, Image,
  Terminal, Database, Globe, Braces, FileJson,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface IconCfg { Icon: LucideIcon; color: string }
const c = (Icon: LucideIcon, color: string): IconCfg => ({ Icon, color });

const SPECIAL: Record<string, IconCfg> = {
  ".env":              c(Settings,  "#4EAA25"),
  ".gitignore":        c(FileCode2, "#F05032"),
  ".gitattributes":    c(FileCode2, "#F05032"),
  "dockerfile":        c(FileCode2, "#2496ED"),
  "makefile":          c(FileCode2, "#6D8086"),
  "package.json":      c(FileJson,  "#CB3837"),
  "package-lock.json": c(FileJson,  "#CB3837"),
  "tsconfig.json":     c(FileJson,  "#3178C6"),
  "jsconfig.json":     c(FileJson,  "#F7DF1E"),
  ".eslintrc":         c(Settings,  "#4B32C3"),
  ".eslintrc.json":    c(Settings,  "#4B32C3"),
  ".prettierrc":       c(Settings,  "#C188C1"),
  "requirements.txt":  c(FileText,  "#3572A5"),
};

const BY_EXT: Record<string, IconCfg> = {
  py:     c(FileCode2, "#3572A5"),
  ts:     c(FileCode2, "#3178C6"),
  tsx:    c(FileCode2, "#61DAFB"),
  js:     c(FileCode2, "#F7DF1E"),
  jsx:    c(FileCode2, "#61DAFB"),
  mjs:    c(FileCode2, "#F7DF1E"),
  cjs:    c(FileCode2, "#F7DF1E"),
  html:   c(Globe,     "#E34C26"),
  htm:    c(Globe,     "#E34C26"),
  css:    c(FileCode2, "#1572B6"),
  scss:   c(FileCode2, "#CC6699"),
  sass:   c(FileCode2, "#CC6699"),
  less:   c(FileCode2, "#1D365D"),
  json:   c(Braces,    "#CBBB3C"),
  jsonc:  c(Braces,    "#CBBB3C"),
  md:     c(FileText,  "#9CA3AF"),
  mdx:    c(FileText,  "#9CA3AF"),
  txt:    c(FileText,  "#9CA3AF"),
  sh:     c(Terminal,  "#89E051"),
  bash:   c(Terminal,  "#89E051"),
  zsh:    c(Terminal,  "#89E051"),
  fish:   c(Terminal,  "#89E051"),
  ps1:    c(Terminal,  "#5391FE"),
  yml:    c(FileCode2, "#CB171E"),
  yaml:   c(FileCode2, "#CB171E"),
  toml:   c(FileCode2, "#9C4221"),
  ini:    c(Settings,  "#9CA3AF"),
  cfg:    c(Settings,  "#9CA3AF"),
  conf:   c(Settings,  "#9CA3AF"),
  sql:    c(Database,  "#DA5B0B"),
  rs:     c(FileCode2, "#DEA584"),
  go:     c(FileCode2, "#00ADD8"),
  java:   c(FileCode2, "#B07219"),
  kt:     c(FileCode2, "#7F52FF"),
  scala:  c(FileCode2, "#DC322F"),
  cpp:    c(FileCode2, "#F34B7D"),
  cc:     c(FileCode2, "#F34B7D"),
  c:      c(FileCode2, "#A8B9CC"),
  h:      c(FileCode2, "#A8B9CC"),
  hpp:    c(FileCode2, "#F34B7D"),
  cs:     c(FileCode2, "#178600"),
  rb:     c(FileCode2, "#CC342D"),
  php:    c(FileCode2, "#4F5D95"),
  vue:    c(FileCode2, "#41B883"),
  svelte: c(FileCode2, "#FF3E00"),
  dart:   c(FileCode2, "#00B4AB"),
  swift:  c(FileCode2, "#F05138"),
  xml:    c(FileCode2, "#FF6600"),
  csv:    c(Database,  "#CBBB3C"),
  env:    c(Settings,  "#4EAA25"),
  png:    c(Image,     "#FF9A00"),
  jpg:    c(Image,     "#FF9A00"),
  jpeg:   c(Image,     "#FF9A00"),
  gif:    c(Image,     "#FF9A00"),
  svg:    c(Image,     "#FF9A00"),
  webp:   c(Image,     "#FF9A00"),
  ico:    c(Image,     "#FF9A00"),
  bmp:    c(Image,     "#FF9A00"),
  avif:   c(Image,     "#FF9A00"),
  tiff:   c(Image,     "#FF9A00"),
  pdf:    c(FileText,  "#E2432A"),
  zip:    c(File,      "#CBBB3C"),
  tar:    c(File,      "#CBBB3C"),
  gz:     c(File,      "#CBBB3C"),
};

export function getFileIconCfg(name: string): IconCfg {
  const lower = name.toLowerCase();
  if (SPECIAL[lower]) return SPECIAL[lower];
  if (lower.startsWith(".env")) return c(Settings, "#4EAA25");
  if (lower.startsWith("dockerfile")) return c(FileCode2, "#2496ED");
  const ext = lower.split(".").pop() || "";
  return BY_EXT[ext] ?? c(FileCode2, "#6B7280");
}

export function FileIcon({
  name, size = 12, className = "", style,
}: {
  name: string; size?: number; className?: string; style?: React.CSSProperties;
}) {
  const { Icon, color } = getFileIconCfg(name);
  return <Icon size={size} style={{ color, ...style }} className={`shrink-0 ${className}`} />;
}
