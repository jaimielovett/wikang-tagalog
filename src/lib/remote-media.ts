// Lessons made on another device travel without their files: a video from YouTube plays through
// YouTube's own player, a podcast episode from its address. Both are driven like a media element,
// so the lantern follows the voice as it does with files on this device.
import type { Lesson } from "./types";

export type RemoteMedia = { kind: "youtube"; id: string } | { kind: "audio"; url: string };

/** The video's id in a YouTube address (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = u.searchParams.get("v") ?? (/^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null);
    }
    return id && /^[\w-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** How a lesson without media on this device can still be heard here, if it can. */
export function remoteMedia(lesson: Pick<Lesson, "media_path" | "source"> & { media_url?: string | null }): RemoteMedia | null {
  if (lesson.media_path) return null;
  const url = lesson.media_url || lesson.source;
  const id = youtubeId(url);
  if (id) return { kind: "youtube", id };
  if (url && /^https:\/\/[^?#]+\.(mp3|m4a|aac|ogg|oga|opus|wav)([?#]|$)/i.test(url)) return { kind: "audio", url };
  return null;
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(r: number): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("YouTube could not be reached"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** YouTube's player inside `host`, with the parts of a media element the reader uses. Events: play, pause, ended, loadedmetadata, error. */
export class YouTubeMedia extends EventTarget {
  private player: YTPlayer | null = null;
  private ready = false;
  private pendingTime = 0;
  private rate = 1;
  private gone = false;
  private box: HTMLDivElement;
  private fallbackDuration: number;
  paused = true;
  ended = false;

  constructor(host: HTMLElement, id: string, fallbackDuration = 0) {
    super();
    this.fallbackDuration = fallbackDuration;
    // YouTube replaces the element it is given: one of our own, not React's
    this.box = document.createElement("div");
    host.appendChild(this.box);
    loadApi().then(
      () => {
        if (this.gone || !window.YT) return;
        this.player = new window.YT.Player(this.box, {
          videoId: id,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1, fs: 0 },
          events: {
            onReady: () => {
              this.ready = true;
              this.player?.setPlaybackRate(this.rate);
              if (this.pendingTime > 0) this.player?.seekTo(this.pendingTime, true);
              this.dispatchEvent(new Event("loadedmetadata"));
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === 1) {
                this.ended = false;
                if (this.paused) {
                  this.paused = false;
                  this.dispatchEvent(new Event("play"));
                }
              } else if (e.data === 2 || e.data === 0) {
                this.ended = e.data === 0;
                if (!this.paused) {
                  this.paused = true;
                  this.dispatchEvent(new Event("pause"));
                }
                if (this.ended) this.dispatchEvent(new Event("ended"));
              }
            },
            onError: () => this.dispatchEvent(new Event("error")),
          },
        });
      },
      () => this.dispatchEvent(new Event("error")),
    );
  }

  get readyState() {
    return this.ready ? 4 : 0;
  }
  get currentTime() {
    return this.ready && this.player ? this.player.getCurrentTime() : this.pendingTime;
  }
  set currentTime(t: number) {
    this.pendingTime = t;
    if (this.ready) this.player?.seekTo(t, true);
  }
  get duration() {
    return (this.ready && this.player?.getDuration()) || this.fallbackDuration;
  }
  get playbackRate() {
    return this.rate;
  }
  set playbackRate(r: number) {
    this.rate = r;
    if (this.ready) this.player?.setPlaybackRate(r);
  }
  async play() {
    if (!this.ready) throw new Error("not ready");
    this.player?.playVideo();
  }
  pause() {
    if (this.ready) this.player?.pauseVideo();
  }
  destroy() {
    this.gone = true;
    try {
      this.player?.destroy();
    } catch {
      /* already gone */
    }
    this.box.remove();
  }
}
