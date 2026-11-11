/**
 * The browser's own dictation, used only when it runs on the device. The Web Speech API's default
 * sends the microphone to the browser vendor's servers; the spec's `processLocally` keeps it on the
 * device, and `SpeechRecognition.available()` says whether that is possible for a language. A
 * browser that cannot promise on-device recognition is never used: there is no server fallback.
 */

export type WebSpeechAvailability = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

export const LANG = 'en-US';

type RecognitionOptions = { langs: string[]; processLocally: boolean };

export type RecognitionLike = {
  lang: string;
  processLocally: boolean;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type RecognitionCtor = {
  new (): RecognitionLike;
  available?(options: RecognitionOptions): Promise<string>;
  install?(options: RecognitionOptions): Promise<boolean>;
};

/** The constructor that can promise on-device recognition, or `null`. */
export function localRecognition(scope: object = globalThis): RecognitionCtor | null {
  const g = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  for (const ctor of [g.SpeechRecognition, g.webkitSpeechRecognition]) {
    if (typeof ctor === 'function' && typeof ctor.available === 'function') return ctor;
  }
  return null;
}

const OPTIONS: RecognitionOptions = { langs: [LANG], processLocally: true };

/**
 * Whether on-device dictation exists here, and whether its language pack is installed. Never throws.
 *
 * A browser driven by automation is treated as having none. A headless Chromium has the API but
 * not the service behind it, and it kills the page that asks (no binder for the on-device speech
 * interface), which no try/catch can stop. Such a browser cannot hear anyone in any case.
 */
export async function webSpeechLocalAvailability(scope: object = globalThis): Promise<WebSpeechAvailability> {
  if ((scope as { navigator?: { webdriver?: boolean } }).navigator?.webdriver) return 'unsupported';
  const ctor = localRecognition(scope);
  if (!ctor) return 'unsupported';
  try {
    const status = await ctor.available!(OPTIONS);
    return status === 'available' || status === 'downloadable' || status === 'downloading' ? status : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Install the language pack. Must be called inside a user gesture: the browser refuses to start
 * the download without one. Resolves whether it is installed.
 */
export async function installWebSpeech(scope: object = globalThis): Promise<boolean> {
  const ctor = localRecognition(scope);
  if (!ctor?.install) return false;
  try {
    return await ctor.install(OPTIONS);
  } catch {
    return false;
  }
}
