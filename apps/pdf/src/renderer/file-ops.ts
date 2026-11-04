/** A page rotation, in degrees clockwise */
export type RotateDelta = 90 | -90 | 180

/** The margins to crop away from every chosen page, in PDF points: left, top, right, bottom */
export type CropRect = { l: number; t: number; r: number; b: number }

/** A native picker was dismissed; flushed = the pending edits had already been saved to disk first */
export type FileOpCanceled = { ok: true; canceled: true; flushed: boolean }

/** In-place rewrite: pageCount is read from the reloaded document */
export type FileOpResult =
  { ok: true; pageCount: number } | FileOpCanceled | { ok: false; error: string }
