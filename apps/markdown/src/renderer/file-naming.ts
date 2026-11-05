/** The name a save offers for a markdown document. */
import type { Editor } from '@tiptap/core'
import { deriveAutoFileName } from './auto-file-name'

/**
 * The name a save should offer, or nothing when it should offer none.
 *
 * This is the whole decision, in one place, because it is the rule the reader
 * feels: a document that already has a name keeps it, and only the reader's own
 * request for a name moves it.
 *
 * - a name the caller proposed outright (the ribbon's "Name with AI") wins:
 *   the reader asked for that name, so nothing else gets a say;
 * - a document that already has a path keeps its name — the save path never
 *   renames a file that is open elsewhere, referenced from a note, or synced;
 * - a save that already carries a name of its own (the AI auto-naming path)
 *   is not asked again;
 * - otherwise the document names itself, from its own first heading, else its
 *   first words. The model is not consulted: a save must not wait on a model
 *   round-trip to learn what the document already says about itself.
 */
export async function proposedSaveName(
  editor: Editor,
  options: { filePath: string | null; suggestedName?: string; proposedName?: string },
): Promise<string | undefined> {
  if (options.proposedName) return options.proposedName
  if (options.filePath) return undefined
  if (options.suggestedName) return undefined
  return deriveAutoFileName(editor) || undefined
}
