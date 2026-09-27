import { highlightIdFor } from '@/capabilities/seating/show_my_table_on_floorplan';
import type { MyTable } from '@/capabilities/seating/get_my_table';
import { FloorPlan } from '@/components/floorplan/FloorPlan';

/**
 * The body of a guest's "Your table" section: table and seat, tablemates, and the floor plan with
 * their table lit. Used by Your Weekend and by the console's seating preview, so the preview is
 * the guest's own markup rather than a description of it.
 */
export function TableCard({ table, idPrefix }: { table: Pick<MyTable, 'table' | 'floorPlan'>; idPrefix?: string }) {
  const where = `${table.table.name}${table.table.seatNumber ? `, seat ${table.table.seatNumber}` : ''}`;
  return (
    <div>
      <p>
        <strong>{table.table.name}</strong>
        {table.table.seatNumber ? `, seat ${table.table.seatNumber}` : ''}
        {table.floorPlan ? ` in the ${table.floorPlan.name}` : ''}.
      </p>
      {table.table.tablemates.length ? <p className="card__meta">With {table.table.tablemates.join(', ')}.</p> : null}
      {table.floorPlan ? (
        <FloorPlan
          name={table.floorPlan.name}
          viewBox={table.floorPlan.viewBox}
          outline={table.floorPlan.outline}
          anchors={table.floorPlan.anchors}
          highlightAnchorId={table.table.anchorId}
          highlightLabel={where}
          highlightDomId={idPrefix ? undefined : highlightIdFor(table.table.anchorId, table.table.id)}
          placeholder={table.floorPlan.placeholder}
          {...(idPrefix ? { idPrefix } : {})}
        />
      ) : null}
    </div>
  );
}
