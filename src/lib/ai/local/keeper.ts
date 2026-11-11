/**
 * What every page does about the local models, once the page is idle:
 *
 *   1. look for each part, downloading nothing;
 *   2. if this device may install on its own (policy.ts), fetch the matcher; fetch the speech model
 *      only where the browser has no on-device dictation of its own. That is judged by whether the
 *      API exists, never by calling it: asking `SpeechRecognition.available()` kills the page in a
 *      headless Chromium (no binder for the on-device speech interface), which is every browser
 *      test. Whether the language is actually installed is asked when a guest taps the microphone;
 *   3. if the browser offers to download its built-in model, start that on the guest's first tap or
 *      key press anywhere, because the browser only allows it from a gesture.
 *
 * Where the policy says no, nothing installs here: Your Trip installs on first use instead.
 * Never throws; aborting the signal stops whatever has not started yet.
 */
import { localRecognition } from '../../speech/web-speech';
import { autoInstallAllowed } from './policy';
import type { LocalPart, LocalState, LocalStatus } from './spec';

export type KeeperDeps = {
  check(part: LocalPart): Promise<LocalState>;
  ensureLocal(part: LocalPart, opts?: { userGesture?: boolean }): Promise<boolean>;
  getStatus(): LocalStatus;
  allowed?: () => Promise<boolean>;
  /** Whether the browser has an on-device dictation API at all. A plain look, no call. */
  hasDictation?: () => boolean;
  /** Where to listen for the first gesture. */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
};

const MISSING: LocalState[] = ['absent', 'failed'];

export async function keepLocalModels(deps: KeeperDeps, signal?: AbortSignal): Promise<void> {
  try {
    await Promise.all((['matcher', 'speech', 'writer'] as const).map((part) => deps.check(part)));
    if (signal?.aborted) return;
    if (!(await (deps.allowed ?? autoInstallAllowed)())) return;

    // One at a time: the matcher is the one every answer can use, so it goes first.
    if (MISSING.includes(deps.getStatus().matcher.state)) await deps.ensureLocal('matcher');
    if (signal?.aborted) return;

    if (MISSING.includes(deps.getStatus().speech.state)) {
      const hasDictation = (deps.hasDictation ?? (() => localRecognition() !== null))();
      if (!hasDictation) await deps.ensureLocal('speech');
    }
    if (signal?.aborted) return;

    const target = deps.target ?? (typeof window === 'undefined' ? undefined : window);
    if (deps.getStatus().writer.state === 'absent' && target) {
      const onGesture = () => {
        target.removeEventListener('pointerdown', onGesture, true);
        target.removeEventListener('keydown', onGesture, true);
        void deps.ensureLocal('writer', { userGesture: true });
      };
      target.addEventListener('pointerdown', onGesture, true);
      target.addEventListener('keydown', onGesture, true);
      signal?.addEventListener(
        'abort',
        () => {
          target.removeEventListener('pointerdown', onGesture, true);
          target.removeEventListener('keydown', onGesture, true);
        },
        { once: true },
      );
    }
  } catch {
    // Nothing here is worth a broken page.
  }
}
