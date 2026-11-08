import path from "node:path";
import type { HarnessLaunch, HarnessLaunchRequest, Harnesses } from "../../application/ports.ts";
import type { Harness } from "../../domain/agent.ts";
import { prepareClaude } from "./claude.ts";
import { prepareCodex } from "./codex.ts";
import type { HarnessFiles } from "./files.ts";
import { preparePi } from "./pi.ts";

type Prepare = (req: HarnessLaunchRequest, files: HarnessFiles) => Promise<HarnessLaunch>;

const PREPARERS: Readonly<Record<Harness, Prepare>> = {
  claude: prepareClaude,
  codex: prepareCodex,
  pi: preparePi,
};

export interface HarnessAdaptersOptions {
  /** Each agent's files go in `<agentsDir>/<agentId>/`. */
  readonly agentsDir: string;
  readonly piExtension: string;
}

/** Picks the adapter for the agent's harness. */
export class HarnessAdapters implements Harnesses {
  private readonly options: HarnessAdaptersOptions;

  constructor(options: HarnessAdaptersOptions) {
    this.options = options;
  }

  prepare(req: HarnessLaunchRequest): Promise<HarnessLaunch> {
    const agentDir = path.join(this.options.agentsDir, req.agentId);
    return PREPARERS[req.spec.harness](req, { agentDir, piExtension: this.options.piExtension });
  }
}
