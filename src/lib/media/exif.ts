/**
 * Capture metadata for the archive (server-side only). We read capture time and camera,
 * and only *whether* location was present; coordinates are never kept (ADR-0005 section 3).
 */
export interface ImageMetadata {
  capturedAt?: Date;
  make?: string;
  model?: string;
  orientation?: number;
  hadLocation: boolean;
}

interface ExifrLike {
  parse(input: Uint8Array | Buffer, options?: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
  gps(input: Uint8Array | Buffer): Promise<{ latitude?: number; longitude?: number } | undefined>;
}

async function exifr(): Promise<ExifrLike> {
  const mod = (await import('exifr')) as unknown as { default?: ExifrLike } & ExifrLike;
  return mod.default ?? mod;
}

const PICK = ['DateTimeOriginal', 'CreateDate', 'DateTime', 'Make', 'Model', 'Orientation'];

function asDate(v: unknown): Date | undefined {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v;
  if (typeof v === 'string') {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
    if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
    const d = new Date(v);
    if (Number.isFinite(d.getTime())) return d;
  }
  return undefined;
}

function clean(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined;
}

/**
 * Reads EXIF from a full image file. Containers exifr cannot open (WebP) fall back to the raw EXIF
 * segment that sharp exposes. Never throws: missing or broken metadata means "nothing known".
 */
export async function readImageMetadata(bytes: Uint8Array, opts: { exifSegment?: Uint8Array } = {}): Promise<ImageMetadata> {
  const out: ImageMetadata = { hadLocation: false };
  let lib: ExifrLike;
  try {
    lib = await exifr();
  } catch {
    return out;
  }
  const sources: Uint8Array[] = [bytes];
  if (opts.exifSegment) sources.push(opts.exifSegment);
  for (const source of sources) {
    try {
      const tags = await lib.parse(source, { pick: PICK, gps: true, xmp: false, icc: false, iptc: false, ifd1: false, mergeOutput: true, translateValues: false });
      if (tags) {
        out.capturedAt ??= asDate(tags['DateTimeOriginal']) ?? asDate(tags['CreateDate']) ?? asDate(tags['DateTime']);
        out.make ??= clean(tags['Make']);
        out.model ??= clean(tags['Model']);
        if (typeof tags['Orientation'] === 'number') out.orientation ??= tags['Orientation'] as number;
      }
    } catch {
      // unsupported container or corrupt segment: try the next source
    }
    try {
      const gps = await lib.gps(source);
      if (gps && (typeof gps.latitude === 'number' || typeof gps.longitude === 'number')) out.hadLocation = true;
    } catch {
      // as above
    }
    if (out.capturedAt || out.make || out.hadLocation) break;
  }
  return out;
}

/** Location presence check used to verify served derivatives: true when any GPS survives. */
export async function hasLocationMetadata(bytes: Uint8Array, exifSegment?: Uint8Array): Promise<boolean> {
  return (await readImageMetadata(bytes, { exifSegment })).hadLocation;
}
