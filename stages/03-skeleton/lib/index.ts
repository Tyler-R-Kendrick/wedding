/**
 * Stage 3's public surface. Stage 4 renders exactly these components and changes only two things:
 * which content fills the slots (ContentProvider) and which design the --st-* tokens resolve to.
 */
export { PageView } from './PageView';
export { SiteShell } from './shell';
export { Blocks, BlockView } from './blocks';
export { ContentProvider, PageScope, Media, Text, useSlot, type Resolver, type Slot } from './content';
export { BREAKPOINTS, bonesFor, descriptorFor, type Shape } from './bones';
