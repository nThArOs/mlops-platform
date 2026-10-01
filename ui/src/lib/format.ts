export function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} B` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function count(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function files(n: number): string {
  return `${count(n)} ${n === 1 ? "file" : "files"}`;
}

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return date(iso);
}

export function date(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function kind(path: string): "image" | "text" | "other" {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (["txt", "csv", "tsv", "json", "yaml", "yml", "xml", "md", "ini", "log"].includes(ext)) return "text";
  return "other";
}
