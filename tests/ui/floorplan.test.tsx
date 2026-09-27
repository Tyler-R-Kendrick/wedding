import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FloorPlan } from '@/components/floorplan/FloorPlan';

describe('the floor plan on a guest page', () => {
  it('says a schematic plan is a placeholder without printing the authoring marker', () => {
    const { container } = render(
      <FloorPlan name="White City Ballroom" viewBox="0 0 100 100" outline="M0 0H100V100H0Z" anchors={[{ id: 't1', x: 10, y: 10, label: '1' }]} highlightAnchorId="t1" highlightLabel="Table 1" placeholder />,
    );
    expect(container.textContent).toContain('Schematic layout.');
    expect(container.querySelector('[data-placeholder="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain('TODO(');
  });
});
