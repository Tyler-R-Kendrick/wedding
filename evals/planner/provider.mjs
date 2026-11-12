// promptfoo provider: the "model" under test is the site's own planner.
import { answer } from './.build/answer.mjs';

export default class PlannerProvider {
  id() {
    return 'your-trip-planner';
  }
  async callApi(_prompt, context) {
    const v = context?.vars ?? {};
    try {
      const out = answer({ request: String(v.request ?? ''), saved: v.saved, prefs: v.prefs, answers: v.answers, events: v.events });
      return { output: JSON.stringify(out) };
    } catch (e) {
      return { error: `planner threw: ${e?.stack ?? e}` };
    }
  }
}
