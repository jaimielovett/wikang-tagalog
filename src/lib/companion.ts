// The desktop companion: it imports and transcribes, then hands each lesson to the learner's
// account and forgets it. A lesson made here waits in this computer's database (the outbox,
// src-tauri/src/outbox.rs) until it reaches the account: right away, or once back online.
import { invoke } from "@tauri-apps/api/core";
import type { Api } from "./api";
import { t } from "./i18n";
import { MAX_RECORDING, accountLesson, planFor, type OutboxLesson } from "./companion-plan";
import { PRIVATE_MEDIA } from "./remote-media";
import { useApp } from "./store";
import { cloud, useAccount } from "./web/cloud";
import { RECORD_VERSION } from "./web/sync";
import { remoteFor } from "./web/storage";

let sending: Promise<number> | null = null;

/** Sends every lesson waiting here to the account, oldest first; returns how many arrived. */
export function sendOutbox(): Promise<number> {
  sending ??= (async () => {
    try {
      return await send();
    } finally {
      sending = null;
    }
  })();
  return sending;
}

async function send(): Promise<number> {
  const user = useAccount.getState().session?.user;
  if (!cloud || !user) return 0;
  // lessons from before the companion (the old desktop library) stay where they are
  const from = Number((await invoke<Record<string, string>>("settings_get")).outbox_from) || 0;
  const waiting = (await invoke<OutboxLesson[]>("outbox_lessons")).filter((l) => l.id > from);
  let sent = 0;
  for (const l of waiting) {
    const plan = planFor(l);
    // ids from the clock, as the web hands them out: never the same as another device's
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    let media_url = plan.media_url;
    if (plan.upload) {
      const bytes = await invoke<ArrayBuffer>("read_file", { path: plan.upload.from });
      if (bytes.byteLength > MAX_RECORDING)
        throw new Error(t(`« ${l.title} » est trop long pour être gardé en ligne (150 Mo au plus).`, `“${l.title}” is too large to keep online (150 MB at most).`));
      const path = `${user.id}/${id}.${plan.upload.ext}`;
      const { error } = await cloud.storage.from("learner-media").upload(path, new Blob([bytes], { type: plan.upload.type }), { contentType: plan.upload.type, upsert: false });
      if (error) throw new Error(t(`Le son de « ${l.title} » n'a pas pu être envoyé : ${error.message}`, `The sound of “${l.title}” couldn't be sent: ${error.message}`));
      media_url = `${PRIVATE_MEDIA}${path}`;
    }
    await remoteFor(user.id).push([{ key: `lesson:${id}`, data: accountLesson(l, id, media_url, plan.kind), updated_at: new Date().toISOString(), version: RECORD_VERSION }]);
    // in the account now: this computer's copy and its files go
    await invoke("lessons_delete", { ids: [l.id] });
    sent++;
    useApp.getState().toast(t(`« ${l.title} » est dans votre bibliothèque`, `“${l.title}” is in your library`), "light");
  }
  return sent;
}

/** Calls that make a lesson: the lesson leaves for the account as soon as it is made. */
const MAKERS = new Set(["lessonCreate", "importMedia", "importLink", "importSong"]);

/** The desktop API, sending each new lesson to the account; a failure leaves it waiting here. */
export function sendingToAccount(api: Api): Api {
  return new Proxy(api, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (typeof value !== "function" || typeof name !== "string" || !MAKERS.has(name)) return value;
      return async (...args: unknown[]) => {
        const out = await value.apply(target, args);
        await sendOutbox().catch((e) =>
          useApp
            .getState()
            .toast(
              `${e instanceof Error ? e.message : String(e)} ${t("La leçon attend sur cet ordinateur et partira dès que possible.", "The lesson is waiting on this computer and will be sent as soon as possible.")}`,
              "error",
            ),
        );
        return out;
      };
    },
  });
}

/** Lessons left waiting (offline, signed out) leave when the companion opens, comes back online, or every few minutes. */
export async function startOutbox() {
  // the first time: what this computer already holds is not new, and never leaves on its own
  const settings = await invoke<Record<string, string>>("settings_get");
  if (!settings.outbox_from) {
    const held = await invoke<OutboxLesson[]>("outbox_lessons");
    await invoke("settings_set", { key: "outbox_from", value: String(Math.max(0, ...held.map((l) => l.id))) });
  }
  const retry = () => void sendOutbox().catch(() => {});
  retry();
  window.addEventListener("online", retry);
  window.setInterval(retry, 5 * 60_000);
}
