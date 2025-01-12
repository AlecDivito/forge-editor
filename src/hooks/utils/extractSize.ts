export default function extractSize(
  entry: ResizeObserverEntry,
  boxProp: "borderBoxSize" | "contentBoxSize" | "devicePixelContentBoxSize",
  sizeType: keyof ResizeObserverSize
): number | undefined {
  if (!entry[boxProp]) {
    if (boxProp === "contentBoxSize") {
      // The dimensions in `contentBoxSize` and `contentRect` are equivalent according to the spec.
      // See the 6th step in the description for the RO algorithm:
      // https://drafts.csswg.org/resize-observer/#create-and-populate-resizeobserverentry-h
      // > Set this.contentRect to logical this.contentBoxSize given target and observedBox of "content-box".
      // In real browser implementations of course these objects differ, but the width/height values should be equivalent.
      return entry.contentRect[sizeType === "inlineSize" ? "width" : "height"];
    }

    return undefined;
  }

  // A couple bytes smaller than calling Array.isArray() and just as effective here.
  return entry[boxProp][0]
    ? entry[boxProp][0][sizeType]
    : // TS complains about this, because the RO entry type follows the spec and does not reflect Firefox's current
      // behaviour of returning objects instead of arrays for `borderBoxSize` and `contentBoxSize`.
      // @ts-expect-error idk
      entry[boxProp][sizeType];
}
