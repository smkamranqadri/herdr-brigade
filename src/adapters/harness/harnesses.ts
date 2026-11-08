import path from "node:path";
import type { HarnessLaunch, HarnessLaunchRequest, Harnesses } from "../../application/ports.ts";
import type { Harness } from "../../domain/agent.ts";
import { BrigadeError } from "../../domain/errors.ts";
import { prepareClaude } from "./claude.ts";

type Prepare = (req: HarnessLaunchRequest, agentDir: string) => Promise<HarnessLaunch>;

const PREPARERS: Partial<Record<Harness, Prepare>> = {
  claude: prepareClaude,
};

/** Picks the adapter for the agent's harness. Each agent's files go in `<agentsDir>/<agentId>/`. */
export class HarnessAdapters implements Harnesses {
  private readonly agentsDir: string;

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir;
  }

  prepare(req: HarnessLaunchRequest): Promise<HarnessLaunch> {
    const prepare = PREPARERS[req.spec.harness];
    if (!prepare) throw new BrigadeError(`The ${req.spec.harness} harness is not supported yet. Use claude.`);
    return prepare(req, path.join(this.agentsDir, req.agentId));
  }
}
