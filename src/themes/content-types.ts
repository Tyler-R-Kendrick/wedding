import type { ReactNode } from 'react';
import type { FindAdventuresData } from '@/capabilities/find_adventures';
import type { FaqPageData } from '@/capabilities/get_faq';
import type { StoryPageData } from '@/capabilities/get_story';
import type { ExploreCaaPageData } from '@/capabilities/get_venue_facts';
import type { AdventuresPageData } from '@/capabilities/list_adventures';
import type { ItinerariesData } from '@/capabilities/list_itineraries';
import type { StaticSearchData } from '@/capabilities/search_wedding_information_static';
import type { AdventureDetailData } from '@/capabilities/show_adventure';
import type { VenueRoomData } from '@/capabilities/show_venue_room';
import type {
  AdventureCard, FaqView, HandoffView, ItineraryView, OperationalFieldView, ProvenanceViewData, RecommendationCard, RecommendationSummary, StorySectionView, TextBlockView, VenueFactView,
  VenueSpaceView, WeddingEventView,
} from '@/domain/content/views';
import type { WeddingPageData } from '@/domain/venue/wedding-page';
import type { PageFrame } from './types';

/*
 * Level-05 content pages (Our Story, Our Adventures, Share an Adventure, Explore CAA, The Wedding,
 * Ask Us). Swarm C's capability outputs and view shapes are the contract; these props mirror
 * `src/app/(public)/_recipes` structurally so the dispatch there type-checks against both sides.
 * A theme adds `frame` (facts, lifecycle, nav, switcher) and owns expression only.
 */

export interface StoryProps {
  data: StoryPageData;
}
export interface AdventuresProps {
  data: AdventuresPageData;
  active: { tag?: string; season?: string };
}
export interface AdventureDetailProps {
  data: AdventureDetailData;
}
export interface GuideProps {
  itineraries: ItinerariesData;
  recommendations: FindAdventuresData;
  activeBucket?: string;
  plan?: { minutes: number; kids: boolean; interest?: string; result: FindAdventuresData['plan'] };
}
export interface RecommendationProps {
  card: RecommendationCard;
}
export interface ExploreCaaProps {
  data: ExploreCaaPageData;
}
export interface VenueSpaceProps {
  data: VenueRoomData;
}
export interface WeddingProps {
  data: WeddingPageData;
}
export interface AskProps {
  faq: FaqPageData;
  search?: StaticSearchData;
}

export type Framed<P> = P & { frame: PageFrame };
export type ContentRecipe<P> = (props: Framed<P>) => ReactNode;

export interface ContentRecipes {
  story: ContentRecipe<StoryProps>;
  adventures: ContentRecipe<AdventuresProps>;
  adventureDetail: ContentRecipe<AdventureDetailProps>;
  guide: ContentRecipe<GuideProps>;
  recommendation: ContentRecipe<RecommendationProps>;
  exploreCaa: ContentRecipe<ExploreCaaProps>;
  venueSpace: ContentRecipe<VenueSpaceProps>;
  wedding: ContentRecipe<WeddingProps>;
  ask: ContentRecipe<AskProps>;
}
export type ContentRecipeKey = keyof ContentRecipes;

/* ------------------------------------------------------------------------------------------------
 * Content kit: the primitives the content recipes compose. Same props, names and states in both
 * themes; markup and CSS differ (Gilded Hour: plaques, ledgers, diptychs, floor plans on one axis;
 * Conservatory: stems, pressed cards, kraft tags, jar labels on the sheet).
 * ---------------------------------------------------------------------------------------------- */

export interface ChipItem {
  href: string;
  label: string;
  active?: boolean;
}

export interface StopItem {
  recommendation: RecommendationSummary;
  minutes?: number;
  note?: string;
}

export interface ContentKit {
  /** Title block of a content page: section eyebrow, H1, lede, optional facts under it. */
  PageHead: (p: { eyebrow: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) => ReactNode;
  /** Our Story chapters in order, each with its provenance; placeholders stay marked. */
  StoryTimeline: (p: { sections: StorySectionView[] }) => ReactNode;
  /** Placeholder-aware prose: facts become paragraphs, placeholders become marked blocks. */
  ProseBlock: (p: { blocks: readonly TextBlockView[]; lead?: boolean; children?: ReactNode }) => ReactNode;
  /** A memory with the two-voice layer ("Sara remembers" / "Tyler remembers"). */
  MemoryCard: (p: { memory: TextBlockView[]; sara?: TextBlockView; tyler?: TextBlockView; accessibility?: TextBlockView; provenance: ProvenanceViewData }) => ReactNode;
  /** Filter links (tags, seasons, itinerary buckets); the active one carries aria-current. */
  Chips: (p: { items: ChipItem[]; label: string }) => ReactNode;
  /** "Draft — not yet curated" / "Details to come". Renders nothing when neither applies. */
  StatusFlags: (p: { draft?: boolean; placeholder?: boolean }) => ReactNode;
  /** Label/value facts as a definition list. */
  MetaList: (p: { items: { label: string; value: ReactNode }[] }) => ReactNode;
  /** Our Adventures archive entries (`article[data-adventure]`). */
  AdventureList: (p: { items: AdventureCard[] }) => ReactNode;
  /**
   * The practical card (`article[data-recommendation]`) with handoffs and the memory layer.
   * `headingLevel` places the card in the page's outline: 2 when the card is the page's subject,
   * 3 on its own, 4 when it sits inside a category heading.
   */
  RecommendationCard: (p: { card: RecommendationCard; headingLevel?: 2 | 3 | 4 }) => ReactNode;
  /** Explicit external handoffs: provider named, new tab, disclosure printed. */
  Handoffs: (p: { handoffs: HandoffView[]; label: string }) => ReactNode;
  /** Stops of an itinerary or a composed plan, in order. */
  StopList: (p: { stops: StopItem[]; label: string }) => ReactNode;
  /** One itinerary (`article[data-itinerary]`). */
  ItineraryCard: (p: { itinerary: ItineraryView; index: number }) => ReactNode;
  /** Docent list: what to look for in the building or a room. */
  LookForList: (p: { items: { id: string; text: string }[]; label: string }) => ReactNode;
  /** The four event spaces (`article[data-space]`): floor plan (Gilded Hour) / specimen sheets (Conservatory). */
  RoomGrid: (p: { spaces: VenueSpaceView[] }) => ReactNode;
  /** Kit capacity figures with the caption that says they are kit figures. */
  CapacityTable: (p: { capacities: VenueSpaceView['capacities'] }) => ReactNode;
  /** Operational links (`li[data-key]`) with a freshness badge on every row. */
  OutletList: (p: { fields: OperationalFieldView[]; label: string }) => ReactNode;
  /** Cited statements (`li#fact-<slug>`). */
  FactList: (p: { facts: VenueFactView[]; label: string }) => ReactNode;
  /** The wedding-day skeleton: times and rooms only as placeholders. */
  Programme: (p: { events: WeddingEventView[]; venueName: string; startNumber: number }) => ReactNode;
  /** FAQ entries; questions are headings under the section heading. */
  FaqList: (p: { entries: FaqView[]; labelFor: (route: string) => string }) => ReactNode;
  /** Static search results (`#search-results`, polite live region). */
  SearchResults: (p: { search: StaticSearchData }) => ReactNode;
  /** Source + freshness line. */
  Provenance: (p: { provenance: ProvenanceViewData; freshness?: boolean }) => ReactNode;
  /** "← All adventures" style return link. */
  BackLink: (p: { href: string; children: ReactNode }) => ReactNode;
}
