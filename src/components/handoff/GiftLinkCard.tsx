import type { GiftLinkView } from '@/domain/gifts/service';
import { ExternalHandoffCard } from './ExternalHandoffCard';

export function GiftLinkCard({ link }: { link: GiftLinkView }) {
  return <ExternalHandoffCard heading={link.label} handoff={link} note={link.note} placeholder={link.placeholder} recordVia={{ capability: 'open_gift_link', input: { linkId: link.id } }} />;
}
