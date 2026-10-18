import { formatMinutes } from '@/domain/adventures/itineraries';
import { humanize } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import type { GuideProps } from '@/themes/content-types';
import type { ThemeId } from '@/themes/types';
import { CONTENT_COPY, INTEREST_OPTIONS, MINUTE_OPTIONS } from '@/themes/shared/content';

/** Native choices keep planning quick, keyboard friendly and usable without JavaScript. */
export function GuestPlanBuilder({ plan, theme }: { plan: GuideProps['plan']; theme: ThemeId }) {
  return (
    <form className="guest-plan-builder" method="get" action={`${ROUTES.share}#plan-result`}>
      <input type="hidden" name="theme" value={theme} />
      <p>A little free time or a whole afternoon? Start with what sounds good.</p>
      <fieldset className="guest-choices">
        <legend>{CONTENT_COPY.guide.minutes}</legend>
        <div className="guest-choices__options">
          {MINUTE_OPTIONS.map((minutes) => <label key={minutes}><input type="radio" name="minutes" value={minutes} defaultChecked={minutes === (plan?.minutes ?? 120)} /><span>{formatMinutes(minutes)}</span></label>)}
        </div>
      </fieldset>
      <fieldset className="guest-choices">
        <legend>{CONTENT_COPY.guide.mood}</legend>
        <div className="guest-choices__options guest-choices__options--interests">
          {(['', ...INTEREST_OPTIONS]).map((interest) => <label key={interest}><input type="radio" name="interest" value={interest} defaultChecked={interest === (plan?.interest ?? '')} /><span>{interest ? humanize(interest) : 'Surprise me'}</span></label>)}
        </div>
      </fieldset>
      <label className="guest-plan-builder__kids"><input type="checkbox" name="kids" value="1" defaultChecked={plan?.kids ?? false} />{CONTENT_COPY.guide.kids}</label>
      <button className="guest-plan-builder__submit" type="submit">{CONTENT_COPY.guide.suggest} <span aria-hidden="true">→</span></button>
    </form>
  );
}
