declare module 'heic-convert' {
  interface HeicConvertInput {
    buffer: ArrayBufferLike | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }
  function convert(input: HeicConvertInput): Promise<ArrayBuffer>;
  export default convert;
}
