// "My AI data": modules that store something about a user's AI use register a cleaner (delete it)
// and an exporter (return it as JSON-able data). The Settings buttons call all of them.

export type AiDataCleaner = (userId: string) => Promise<void>;
export type AiDataExporter = (userId: string) => Promise<unknown>;

const cleaners: AiDataCleaner[] = [];
const exporters: { name: string; fn: AiDataExporter }[] = [];

export function registerAiDataCleaner(fn: AiDataCleaner): void {
  cleaners.push(fn);
}

/** `name` is the key of this module's data in the downloaded JSON. */
export function registerAiDataExporter(
  fn: AiDataExporter,
  name = `module_${exporters.length + 1}`,
): void {
  exporters.push({ name, fn });
}

export async function clearAiData(userId: string): Promise<void> {
  for (const fn of cleaners) await fn(userId);
}

export async function exportAiData(userId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const { name, fn } of exporters) out[name] = await fn(userId);
  return out;
}
