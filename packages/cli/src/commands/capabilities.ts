import type { CommandDef } from '../registry'
import { appLaunch } from '../resources'

/** What the command line can use on this machine: whether the Apex Office app (needed for layout renders) is installed. */
export const capabilitiesCommand: CommandDef = {
  name: 'capabilities',
  summary:
    'Report whether the Apex Office app is installed (needed for Word, Excel, PowerPoint, Markdown and HTML renders).',
  usage: 'capabilities',
  async run(_args, ctx) {
    const available = appLaunch(ctx.env) !== null
    return {
      summary: available ? 'the app is installed' : 'the app is not installed',
      detail: { app: { available } },
    }
  },
}
