import type { ReactNode } from 'react';
import './floorplan.css';

export interface FloorPlanAnchorView {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface FloorPlanProps {
  /** Guest-visible name of the room (e.g. "White City Ballroom"). */
  name: string;
  viewBox: string;
  /** SVG path for the room outline, in viewBox units. */
  outline: string;
  anchors: FloorPlanAnchorView[];
  /** Anchor id to highlight (the guest's table). */
  highlightAnchorId?: string | null;
  /** Label announced/shown for the highlighted table (e.g. "Table 7, seat 3"). */
  highlightLabel?: string | null;
  /** True while the plan is a schematic placeholder (TODO(Tyler & Sara)). */
  placeholder: boolean;
  /** DOM id for deep links (`show_my_table_on_floorplan` returns `highlight`). */
  highlightDomId?: string;
  children?: ReactNode;
}

/**
 * Theme-agnostic floor plan: an accessible SVG drawn from data (never injected markup).
 * The highlighted table is marked with text as well as colour, and the plan carries a caption
 * so screen-reader users get the same answer as sighted ones.
 */
export function FloorPlan({ name, viewBox, outline, anchors, highlightAnchorId, highlightLabel, placeholder, highlightDomId, children }: FloorPlanProps) {
  const titleId = `fp-title-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const highlighted = anchors.find((a) => a.id === highlightAnchorId);
  return (
    <figure className="fp">
      <svg className="fp__svg" viewBox={viewBox} role="img" aria-labelledby={titleId} focusable="false">
        <title id={titleId}>
          {highlighted && highlightLabel ? `${name} floor plan: your table is ${highlightLabel}.` : `${name} floor plan.`}
        </title>
        <path className="fp__outline" d={outline} />
        {anchors.map((a) => {
          const isMine = a.id === highlightAnchorId;
          return (
            <g key={a.id} id={isMine ? highlightDomId : undefined} className={isMine ? 'fp__table fp__table--mine' : 'fp__table'} transform={`translate(${a.x} ${a.y})`}>
              <circle className="fp__seat" r={isMine ? 30 : 24} />
              <text className="fp__label" textAnchor="middle" dominantBaseline="middle">
                {a.label.replace(/^Table\s+/i, '')}
              </text>
              {isMine ? (
                <text className="fp__you" y={48} textAnchor="middle">
                  You
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="fp__caption">
        {highlighted && highlightLabel ? <strong>Your table: {highlightLabel}.</strong> : null} {placeholder ? <span>Schematic layout — the planner’s floor plan will replace it. TODO(Tyler &amp; Sara)</span> : null}
        {children}
      </figcaption>
    </figure>
  );
}
