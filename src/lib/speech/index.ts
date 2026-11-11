/**
 * Dictation for the planner's ask box, always on the guest's device (browser only).
 *
 *   Route 1: the browser's own speech recognition, but only with `processLocally` (web-speech.ts).
 *   Route 2: the microphone, recorded and decoded here, turned into 16 kHz mono, and transcribed by
 *            the local speech model (`transcribe()` in src/lib/ai/local).
 *
 * Server-based recognition is never used. Where neither route exists, `speechSupport()` says
 * `none` and the page offers typing only.
 */
import { ensureLocal, getLocalModels, transcribe } from '@/lib/ai/local';
import { toMono16k } from './resample';
import { installWebSpeech, LANG, localRecognition, webSpeechLocalAvailability, type RecognitionLike } from './web-speech';

export { toMono16k, resampleLinear, downmix } from './resample';
export { webSpeechLocalAvailability } from './web-speech';

export type SpeechRoute = 'web-speech' | 'recorder' | 'none';

/** Why dictation ended without words. */
export type DictationError = 'not-allowed' | 'no-speech' | 'unavailable' | 'failed';

export type DictationOptions = {
  /** The words so far, while the guest is still speaking (route 1 only). */
  onInterim?(text: string): void;
  /** The finished words. Called at most once. */
  onFinal(text: string): void;
  onError?(error: DictationError): void;
  /** Aborting cancels: the microphone closes and nothing is reported. */
  signal?: AbortSignal;
};

export type Dictation = {
  /** Finish listening and report what was said. */
  stop(): void;
  /** Settles once dictation has ended, however it ended. */
  done: Promise<void>;
};

/** Long enough for a question; one window of the speech model. */
export const MAX_RECORDING_MS = 30_000;

function canRecord(): boolean {
  const g = globalThis as { navigator?: Navigator; MediaRecorder?: unknown; AudioContext?: unknown; Worker?: unknown; WebAssembly?: unknown };
  return (
    typeof g.navigator?.mediaDevices?.getUserMedia === 'function' &&
    typeof g.MediaRecorder === 'function' &&
    typeof g.AudioContext === 'function' &&
    typeof g.Worker === 'function' &&
    typeof g.WebAssembly === 'object' &&
    getLocalModels().speech.state !== 'unsupported'
  );
}

/** Which route dictation would take on this device. Never throws. */
export async function speechSupport(): Promise<SpeechRoute> {
  const local = await webSpeechLocalAvailability();
  if (local === 'available' || local === 'downloadable' || local === 'downloading') return 'web-speech';
  return canRecord() ? 'recorder' : 'none';
}

/**
 * Start listening. Call it from the click or key press that asked for it: installing the browser's
 * language pack needs that gesture. Every outcome arrives through the callbacks; this never throws.
 */
export function startDictation(options: DictationOptions): Dictation {
  let stopRequested = false;
  let stopNow: (() => void) | null = null;
  const done = (async () => {
    try {
      const route = await speechSupport();
      if (options.signal?.aborted) return;
      if (route === 'web-speech') {
        const local = await webSpeechLocalAvailability();
        const installed = local === 'available' || (await installWebSpeech());
        // Cancelled while the language pack installed: start nothing.
        if (options.signal?.aborted) return;
        if (installed) {
          await recognise(options, (stop) => (stopNow = stop), () => stopRequested);
          return;
        }
        if (!canRecord()) {
          options.onError?.('unavailable');
          return;
        }
      } else if (route === 'none') {
        options.onError?.('unavailable');
        return;
      }
      await record(options, (stop) => (stopNow = stop), () => stopRequested);
    } catch {
      if (!options.signal?.aborted) options.onError?.('failed');
    }
  })();
  return {
    stop() {
      stopRequested = true;
      stopNow?.();
    },
    done,
  };
}

/** Route 1: on-device Web Speech. */
function recognise(options: DictationOptions, setStop: (stop: () => void) => void, stopRequested: () => boolean): Promise<void> {
  const Ctor = localRecognition();
  if (!Ctor) {
    options.onError?.('unavailable');
    return Promise.resolve();
  }
  const recognition: RecognitionLike = new Ctor();
  if (!('processLocally' in recognition)) {
    // A browser that would not honour the flag would send the audio away: refuse.
    options.onError?.('unavailable');
    return Promise.resolve();
  }
  recognition.processLocally = true;
  recognition.lang = LANG;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  return new Promise<void>((resolve) => {
    let finalText = '';
    let interimText = '';
    let failed: DictationError | null = null;
    const cancel = () => recognition.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });

    recognition.onresult = (event) => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]!;
        const words = result[0]?.transcript ?? '';
        if (result.isFinal) finals += words;
        else interim += words;
      }
      finalText = finals.trim();
      interimText = interim.trim();
      options.onInterim?.(`${finals}${interim}`.trim());
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      failed =
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'not-allowed'
          : event.error === 'no-speech'
            ? 'no-speech'
            : event.error === 'language-not-supported'
              ? 'unavailable'
              : 'failed';
    };
    recognition.onend = () => {
      options.signal?.removeEventListener('abort', cancel);
      if (!options.signal?.aborted) {
        // Stopped by the guest mid-phrase: what was heard so far is what they said.
        const text = finalText || interimText;
        if (text) options.onFinal(text);
        else options.onError?.(failed ?? 'no-speech');
      }
      resolve();
    };
    setStop(() => recognition.stop());
    recognition.start();
    if (stopRequested()) recognition.stop();
  });
}

/** Route 2: record, decode, 16 kHz mono, local speech model. */
async function record(options: DictationOptions, setStop: (stop: () => void) => void, stopRequested: () => boolean): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    options.onError?.((error as { name?: string })?.name === 'NotAllowedError' ? 'not-allowed' : 'unavailable');
    return;
  }
  // Cancelled while the browser asked for the microphone: close it at once and record nothing.
  if (options.signal?.aborted) {
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  // Fetch the speech model while the guest talks, if this device does not have it yet.
  const modelReady = ensureLocal('speech', { userGesture: true });

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream);
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const finish = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const limit = setTimeout(finish, MAX_RECORDING_MS);
  options.signal?.addEventListener('abort', finish, { once: true });
  setStop(finish);
  recorder.start();
  if (stopRequested()) finish();

  await stopped;
  clearTimeout(limit);
  options.signal?.removeEventListener('abort', finish);
  for (const track of stream.getTracks()) track.stop();
  if (options.signal?.aborted) return;

  const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
  let pcm: Float32Array;
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    pcm = toMono16k(channels, audio.sampleRate);
  } catch {
    options.onError?.('no-speech');
    return;
  } finally {
    void context.close().catch(() => {});
  }

  if (!(await modelReady)) {
    if (!options.signal?.aborted) options.onError?.('unavailable');
    return;
  }
  const text = await transcribe(pcm, { signal: options.signal });
  if (options.signal?.aborted) return;
  if (text === null) options.onError?.('failed');
  else if (!text.trim()) options.onError?.('no-speech');
  else options.onFinal(text.trim());
}
