import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosticEntry } from "@location-changer/core";

export class DiagnosticsLogger {
  constructor(private readonly baseDir: string) {}

  private get logFilePath(): string {
    return path.join(this.baseDir, "app.log");
  }

  async log(entry: DiagnosticEntry): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await appendFile(this.logFilePath, `${JSON.stringify(entry)}\n`, "utf-8");
  }

  async readRecent(limit = 100): Promise<DiagnosticEntry[]> {
    try {
      const raw = await readFile(this.logFilePath, "utf-8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((line: string) => JSON.parse(line) as DiagnosticEntry);
    } catch {
      return [];
    }
  }
}
