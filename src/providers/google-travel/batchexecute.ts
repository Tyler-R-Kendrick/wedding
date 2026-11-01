/**
 * Google batchexecute response decoding (MIT, adapted from website-api google-batchexecute).
 */

export interface DecodedRpcPayload {
  rpcId: string;
  payload: unknown;
  envelope: unknown[];
}

function jsonLines(body: string): unknown[] {
  const clean = body.replace(/^\s*\)\]\}'\s*/, '');
  const values: unknown[] = [];
  for (const line of clean.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate || /^\d+$/.test(candidate) || (!candidate.startsWith('[') && !candidate.startsWith('{'))) continue;
    try {
      values.push(JSON.parse(candidate));
    } catch {
      /* skip malformed frames */
    }
  }
  if (values.length === 0) {
    try {
      values.push(JSON.parse(clean.trim()));
    } catch {
      /* not batchexecute */
    }
  }
  return values;
}

function collectRpcRows(value: unknown, output: unknown[][]): void {
  if (!Array.isArray(value)) return;
  if (value[0] === 'wrb.fr' && typeof value[1] === 'string') {
    output.push(value);
    return;
  }
  for (const child of value) collectRpcRows(child, output);
}

export function decodeBatchexecute(body: string): DecodedRpcPayload[] {
  const rows: unknown[][] = [];
  for (const value of jsonLines(body)) collectRpcRows(value, rows);
  return rows.map((envelope) => {
    const encoded = envelope[2];
    let payload: unknown = encoded;
    if (typeof encoded === 'string') {
      try {
        payload = JSON.parse(encoded);
      } catch {
        /* plain text rpc */
      }
    }
    return { rpcId: String(envelope[1]), payload, envelope };
  });
}
