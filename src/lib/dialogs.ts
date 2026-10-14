import { isTauri } from "./api";
import { t } from "./i18n";

/** Demande de confirmation native (boîte de dialogue macOS dans l'app). */
export async function confirmAsk(message: string, title = "Wikang Tagalog", okLabel = t("Confirmer", "Confirm")): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning", okLabel, cancelLabel: t("Annuler", "Cancel") });
  }
  return window.confirm(message);
}

export async function pickFiles(filters: { name: string; extensions: string[] }[], multiple = true): Promise<string[]> {
  if (!isTauri) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple, filters });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

/** Browser file picker: the chosen files themselves (the web has no paths). */
export function pickWebFiles(extensions: string[], multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = extensions.map((e) => `.${e}`).join(",");
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export async function pickSavePath(defaultPath: string): Promise<string | null> {
  if (!isTauri) return defaultPath;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters: [{ name: "CSV", extensions: ["csv"] }] });
}
