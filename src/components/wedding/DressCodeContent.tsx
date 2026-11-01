import { Text } from '@/components/provenance';
import {
  dressCodeExampleBlocks,
  dressCodeIntroBlock,
  dressCodeSkipBlock,
} from '@/domain/venue/dress-code';

/** Scannable dress-code block: short intro, example list, gentle skip note. */
export function DressCodeContent() {
  const examples = dressCodeExampleBlocks();
  return (
    <>
      <p>
        <Text block={dressCodeIntroBlock()} inline />
      </p>
      <ul>
        {examples.map((block) => (
          <li key={block.text}>
            <Text block={block} inline />
          </li>
        ))}
      </ul>
      <p>
        <Text block={dressCodeSkipBlock()} inline />
      </p>
    </>
  );
}
