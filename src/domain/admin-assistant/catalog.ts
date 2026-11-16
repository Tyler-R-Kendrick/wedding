/**
 * What the console's assistant can look at and what it may propose. Two short lists, read by the
 * server (which composes answers) and the browser (which runs an answer's live queries): a name
 * that is not here is not a tool, whatever a program asks for.
 */

/** Read capabilities an answer may query. Each is authorized again, per call, by the pipeline. */
export const READ_TOOLS = [
  'admin_site_traffic',
  'admin_list_sessions',
  'admin_session_detail',
  'admin_site_errors',
  'admin_ops_metrics',
  'admin_jobs_overview',
  'admin_lifecycle_status',
  'admin_rsvp_overview',
  'admin_search_audit',
] as const;
export type ReadTool = (typeof READ_TOOLS)[number];

/**
 * Changes an answer may propose. A proposal is never run by the assistant: a person reviews it and
 * presses the button, and the capability applies its own confirmation rules (publishing needs the
 * token its draft step issues). Everything else is changed on its own screen, which the assistant
 * links to.
 */
export const PROPOSABLE = ['draft_lifecycle_transition', 'admin_publish_lifecycle', 'admin_retry_job'] as const;

export const VIEW_NAMES = ['attention', 'traffic', 'sessions', 'session', 'errors', 'rsvp', 'pending', 'guest', 'lifecycle', 'jobs', 'metrics', 'activity', 'open', 'help'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export type ViewSpec = {
  name: ViewName;
  /** One line, written for a person choosing and for a small model choosing on their behalf. */
  does: string;
  /** A question this view answers, in an administrator's words. */
  example: string;
};

export const VIEWS: readonly ViewSpec[] = [
  { name: 'attention', does: 'What needs a decision now, as a checklist with the next step for each', example: 'What needs my attention?' },
  { name: 'traffic', does: 'Visits over time: sessions, pages opened, busiest pages, devices, page speed', example: 'How many visits this week?' },
  { name: 'sessions', does: 'The list of recent visitor sessions: who, when, how many pages, errors', example: 'Who visited today?' },
  { name: 'session', does: 'One visitor session, page by page', example: 'Show that session' },
  { name: 'errors', does: 'Errors visitors hit, grouped, with the pages they happened on', example: 'What errors did guests hit?' },
  { name: 'rsvp', does: 'Replies per event: coming, not coming, no answer yet', example: 'How many guests have replied?' },
  { name: 'pending', does: 'The guests who have not replied yet', example: 'Who has not replied?' },
  { name: 'guest', does: 'One guest: household, replies, and their visits', example: 'What has Ada Testhouse done on the site?' },
  { name: 'lifecycle', does: 'The state guests see, what the calendar suggests, and publishing another state', example: 'Open RSVPs' },
  { name: 'jobs', does: 'Background jobs: queued, failed, and retrying a failed one', example: 'Are any jobs stuck?' },
  { name: 'metrics', does: 'Timings and counts the site recorded about itself: slow actions, sign-ins, answers', example: 'What is slow?' },
  { name: 'activity', does: 'Recent actions from the audit trail, and refused ones', example: 'What changed recently?' },
  { name: 'open', does: 'Find the console screen where something is edited', example: 'Where do I edit the hotel block?' },
  { name: 'help', does: 'What can be asked here', example: 'What can you do?' },
];

export const isViewName = (v: unknown): v is ViewName => typeof v === 'string' && (VIEW_NAMES as readonly string[]).includes(v);

/** The time windows an answer offers, in hours. */
export const WINDOWS = [
  { hours: 24, label: '24h', words: 'the last 24 hours' },
  { hours: 168, label: '7d', words: 'the last 7 days' },
  { hours: 720, label: '30d', words: 'the last 30 days' },
] as const;
export const windowWords = (hours: number) => WINDOWS.find((w) => w.hours === hours)?.words ?? `the last ${hours} hours`;
