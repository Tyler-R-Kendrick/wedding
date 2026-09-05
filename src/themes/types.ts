import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import type { LifecycleState } from '@/contracts/lifecycle';

/**
 * Theme engine contracts (ADR-0009). One domain, two themes: routes, data, capabilities and
 * copy are theme-agnostic; a theme owns expression only. Every kit component has the same
 * props, accessible name, focus order and states in both themes; markup and CSS may differ.
 */
export type ThemeId = 'gilded-hour' | 'conservatory';

export interface ThemeFontFile {
  family: string;
  /** Public URL of the woff2 file (preloaded only for the active theme). */
  url: string;
  weight: string;
  style: 'normal' | 'italic';
}

/** Motion vocabulary per theme (design-doc §7). Both collapse to opacity-only ≤200 ms under reduced motion. */
export interface MotionSpec {
  pageEnter: string;
  sectionReveal: string;
  interaction: string;
  dialog: string;
  reducedMotion: string;
}

/** Structural signature, asserted by tests so the two themes stay structurally different. */
export interface ThemeStructure {
  layout: 'centered-axis' | 'left-weighted-sheet';
  navDesktop: 'frieze' | 'tag-rail';
  navMobile: 'elevator-panel' | 'menu-tag-and-two-action-bar';
  sections: 'numbered-acts' | 'washes-and-fern-dividers';
  ornament: 'gold-geometry' | 'line-art-foliage';
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  designMd: string;
  fonts: ThemeFontFile[];
  colorScheme: 'light';
  structure: ThemeStructure;
  motion: MotionSpec;
}

/* ------------------------------------------------------------------------------------------------
 * Theme-agnostic data the recipes render. Components never read a fact; pages fetch through
 * capabilities / the lifecycle domain and pass typed data down.
 * ---------------------------------------------------------------------------------------------- */

/** Editorial placeholder: rendered as a clearly marked TODO(Tyler & Sara), never as prose. */
export interface Placeholder {
  todo: string;
}
export type CopyPart = string | Placeholder;
export type Copy = CopyPart[];

export interface ActionLink {
  label: string;
  href: string;
  /** primary = the state's one action; accent = RSVP-class; secondary/ghost; external = provider handoff. */
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'external';
  /** Shown to the guest before an external handoff ("Continue securely with Uber"). */
  provider?: string;
}

export interface NavItem {
  label: string;
  href: string;
  external?: boolean;
  provider?: string;
}

export interface NavModel {
  /** ≤5 items on mobile; desktop shows primary + more in state order. */
  primary: NavItem[];
  more: NavItem[];
  /** Sticky / quick actions for the state (mobile bottom bar). */
  sticky: NavItem[];
  currentPath: string;
}

export interface DateFacts {
  iso: string;
  /** "Saturday, July 17, 2027" */
  long: string;
  /** "07 · 17 · 27" */
  motif: string;
  weekday: string;
  timezone: string;
}

export interface VenueFacts {
  name: string;
  address: string;
  city: string;
  url: string | null;
  mapsUrl: string;
  mapsProvider: string;
}

export interface SiteFacts {
  coupleDisplayName: string;
  partner1: string;
  partner2: string;
  date: DateFacts;
  venue: VenueFacts;
}

export interface CountdownView {
  days: number;
  isToday: boolean;
  isPast: boolean;
  /** ISO wedding date the client re-computes against. */
  weddingDateIso: string;
  timezone: string;
}

export interface LifecycleView {
  state: LifecycleState;
  mode: 'explore' | 'act' | 'operate' | 'remember';
  persistedState: LifecycleState;
  preview: { state: LifecycleState; source: 'query' | 'cookie'; expiresAt: string | null } | null;
  suggested: LifecycleState;
  publishedAt: string | null;
  note: string | null;
}

/** Everything a page recipe needs besides its own content. */
export interface PageFrame {
  theme: ThemeId;
  site: SiteFacts;
  lifecycle: LifecycleView;
  countdown: CountdownView;
  nav: NavModel;
  /** Rendered switcher control (null when FLAG_DESIGN_SWITCHER is off). */
  switcher: ReactNode;
}

export interface HomeData extends PageFrame {
  content: HomeContent;
}

export type HomeAct = 'adventure' | 'place' | 'memory' | 'hospitality' | 'future' | 'now' | 'thanks';

export interface HomeSection {
  id: string;
  act: HomeAct;
  /** Eyebrow (Gilded Hour) / specimen label (Conservatory): the five motifs in explore mode, a functional word otherwise. */
  label: string;
  title: string;
  body: Copy;
  link?: ActionLink;
  /** Optional structured facts (e.g. venue) rendered as Stat / MapHandoff by the theme. */
  facts?: StatProps[];
  /** Timeline events for the "Today" / wedding-week acts. */
  timeline?: TimelineEvent[];
  map?: boolean;
}

export interface HomeContent {
  /** "Today" on WEDDING_DAY; otherwise the couple's names. */
  title: string;
  eyebrow: string;
  lede: Copy;
  primary: ActionLink;
  secondary?: ActionLink;
  /** RSVP deadline etc. shown beside the primary action. */
  deadline?: Copy;
  showCountdown: boolean;
  sections: HomeSection[];
}

export interface StoryChapter {
  id: string;
  title: string;
  body: Copy;
  media?: ImageFrameProps;
}
export interface StoryPageData extends PageFrame {
  title: string;
  intro?: Copy;
  chapters: StoryChapter[];
}

export interface ArchiveItem {
  id: string;
  title: string;
  summary: Copy;
  href?: string;
  label?: string;
  tags?: string[];
  media?: ImageFrameProps;
}
export interface ArchivePageData extends PageFrame {
  title: string;
  intro?: Copy;
  items: ArchiveItem[];
  emptyMessage?: string;
}

export interface DetailSection {
  id: string;
  heading: string;
  body: Copy;
  facts?: StatProps[];
  timeline?: TimelineEvent[];
  map?: boolean;
}
export interface DetailPageData extends PageFrame {
  title: string;
  intro?: Copy;
  sections: DetailSection[];
  actions?: ActionLink[];
}

export interface FormPageData extends PageFrame {
  title: string;
  intro?: Copy;
  form: ReactNode;
  summary?: ReactNode;
}

export interface DashboardPanel {
  id: string;
  title: string;
  body: ReactNode;
  actions?: ActionLink[];
}
export interface DashboardPageData extends PageFrame {
  greeting: string;
  status: ReactNode;
  panels: DashboardPanel[];
}

export interface GalleryPageData extends PageFrame {
  title: string;
  intro?: Copy;
  items: GalleryItem[];
  rightsNote: string;
  upload?: ActionLink;
}

/* ------------------------------------------------------------------------------------------------
 * Kit contracts (design-doc §6). Identical across themes.
 * ---------------------------------------------------------------------------------------------- */

export interface ShellProps {
  frame: PageFrame;
  /** Page title for the document header region (visually hidden in some themes). */
  children: ReactNode;
  /** Optional banner (admin preview) rendered as a status region. */
  banner?: ReactNode;
}

export interface NavProps {
  nav: NavModel;
  siteName: string;
  /** "Today" replaces "Home" on WEDDING_DAY. */
  homeLabel: string;
}

export interface FooterProps {
  site: SiteFacts;
  switcher: ReactNode;
  rightsNote: string;
  printUrls: { label: string; url: string }[];
}

export interface HeroProps {
  content: HomeContent;
  site: SiteFacts;
  countdown: CountdownView;
  state: LifecycleState;
}

export interface SectionProps {
  id?: string;
  /** Only real sequences are numbered (the five acts). */
  number?: number;
  ground?: 'default' | 'alt' | 'inverse' | 'wash';
  children: ReactNode;
  labelledBy?: string;
}

export interface SectionHeadingProps {
  level: 1 | 2 | 3;
  title: ReactNode;
  eyebrow?: string;
  lede?: ReactNode;
  id?: string;
}

export interface EyebrowProps {
  children: ReactNode;
  tone?: 'default' | 'moss';
}

export interface ProseProps {
  children: ReactNode;
  lead?: boolean;
}

export interface CardProps {
  title?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  children: ReactNode;
  media?: ReactNode;
  actions?: ReactNode;
  /** Plaque numeral (Gilded Hour) or kraft specimen label (Conservatory). */
  label?: string;
  featured?: boolean;
  index?: number;
  id?: string;
}

export interface ImageFrameProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
  credit?: string;
  sizes?: string;
  priority?: boolean;
}

export interface GalleryItem extends ImageFrameProps {
  id: string;
  downloadable?: boolean;
}
export interface GalleryProps {
  items: GalleryItem[];
  label: string;
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'external';
  href?: string;
  type?: 'button' | 'submit';
  loading?: boolean;
  provider?: string;
  children: ReactNode;
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  external?: boolean;
  children: ReactNode;
}

export interface DividerProps {
  ornament?: boolean;
}

export interface CountdownProps extends CountdownView {
  /** Hidden on WEDDING_DAY (the hero says "Today"). */
  hidden?: boolean;
}

export interface TimelineEvent {
  id: string;
  name: string;
  start?: string | null;
  end?: string | null;
  place?: string | null;
  description?: Copy;
  /** true when times/places are not yet confirmed. */
  placeholder?: boolean;
}
export interface TimelineProps {
  events: TimelineEvent[];
  timezone: string;
  nowId?: string | null;
  label: string;
}

export interface StatProps {
  label: string;
  value: ReactNode;
  provenance?: { source?: string; verifiedAt?: string; stale?: boolean };
  placeholder?: boolean;
}

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  invalid?: boolean;
}
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  invalid?: boolean;
  children: ReactNode;
}
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  invalid?: boolean;
}
export interface ChoiceProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
}
export interface FieldsetProps {
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}
export interface ErrorSummaryProps {
  title?: string;
  errors: { id: string; message: string }[];
}

export interface DialogProps {
  id: string;
  title: string;
  trigger: ReactNode;
  triggerLabel?: string;
  children: ReactNode;
  closeLabel?: string;
}

export interface BadgeProps {
  status: 'ok' | 'pending' | 'stale' | 'info';
  children: ReactNode;
}

export interface MapHandoffProps {
  venue: VenueFacts;
  note?: string;
}

export interface SkeletonProps {
  lines?: number;
  width?: string;
  height?: string;
  label?: string;
}

export interface PlaceholderProps {
  todo: string;
}

export interface FormPrimitives {
  Field: (p: FieldProps) => ReactNode;
  Input: (p: InputProps) => ReactNode;
  Select: (p: SelectProps) => ReactNode;
  Textarea: (p: TextareaProps) => ReactNode;
  Radio: (p: ChoiceProps) => ReactNode;
  Checkbox: (p: ChoiceProps) => ReactNode;
  Fieldset: (p: FieldsetProps) => ReactNode;
  ErrorSummary: (p: ErrorSummaryProps) => ReactNode;
}

export interface ThemeComponentKit {
  Shell: (p: ShellProps) => ReactNode;
  Nav: (p: NavProps) => ReactNode;
  Footer: (p: FooterProps) => ReactNode;
  Hero: (p: HeroProps) => ReactNode;
  Section: (p: SectionProps) => ReactNode;
  SectionHeading: (p: SectionHeadingProps) => ReactNode;
  Eyebrow: (p: EyebrowProps) => ReactNode;
  Prose: (p: ProseProps) => ReactNode;
  Card: (p: CardProps) => ReactNode;
  ImageFrame: (p: ImageFrameProps) => ReactNode;
  Gallery: (p: GalleryProps) => ReactNode;
  Button: (p: ButtonProps) => ReactNode;
  Link: (p: LinkProps) => ReactNode;
  Divider: (p: DividerProps) => ReactNode;
  Countdown: (p: CountdownProps) => ReactNode;
  Timeline: (p: TimelineProps) => ReactNode;
  Stat: (p: StatProps) => ReactNode;
  Form: FormPrimitives;
  Dialog: (p: DialogProps) => ReactNode;
  Badge: (p: BadgeProps) => ReactNode;
  MapHandoff: (p: MapHandoffProps) => ReactNode;
  Skeleton: (p: SkeletonProps) => ReactNode;
  Placeholder: (p: PlaceholderProps) => ReactNode;
  /** Renders Copy (strings + placeholders). */
  Text: (p: { copy: Copy }) => ReactNode;
}

export type PageRecipe<D> = (data: D) => ReactNode;

export interface ThemeRecipes {
  home: PageRecipe<HomeData>;
  story: PageRecipe<StoryPageData>;
  archive: PageRecipe<ArchivePageData>;
  detail: PageRecipe<DetailPageData>;
  form: PageRecipe<FormPageData>;
  dashboard: PageRecipe<DashboardPageData>;
  gallery: PageRecipe<GalleryPageData>;
}

export interface ThemeDefinition extends ThemeMeta {
  kit: ThemeComponentKit;
  recipes: ThemeRecipes;
}
