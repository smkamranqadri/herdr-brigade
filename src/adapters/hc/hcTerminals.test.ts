import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HcTerminals, stillInInput, trustKey } from "./hcTerminals.ts";

function scripted(replies: Record<string, string | string[]>) {
  const calls: string[][] = [];
  const queues = new Map(Object.entries(replies).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const run = (args: readonly string[]) => {
    calls.push([...args]);
    const q = queues.get(args[0] ?? "");
    const reply = (q && q.length > 1 ? q.shift() : q?.[0]) ?? "";
    // A reply that starts with "ERR " stands for hc failing with that message.
    return reply.startsWith("ERR ") ? Promise.reject(new Error(reply.slice(4))) : Promise.resolve(reply);
  };
  let clock = 0;
  const terminals = new HcTerminals({ run, sleep: (ms) => ((clock += ms), Promise.resolve()), now: () => clock });
  return { terminals, calls };
}

const claudeTrust = {
  text: "trust this folder",
  cursor: "❯",
  yes: "Yes, I trust this folder",
  ready: ["? for shortcuts"],
};
const codexTrust = { text: "Trust this folder?", cursor: "›", yes: "Trust and continue", ready: ["? for shortcuts"] };

// Screens drawn by Claude Code 2.1.319 and Codex 0.167.0 (docs/spike-harnesses.md).
const claudeOnNo = [
  " Quick safety check: Is this a project you created or one you trust?",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  " Enter to confirm · Esc to cancel",
].join("\n");
const claudeOnYes = claudeOnNo.replace(" ❯ No, exit", "   No, exit").replace("   Yes, I trust", " ❯ Yes, I trust");
const codexPrompt = [
  "  Trust this folder? Codex can read, edit, and run files here.",
  "› 1. Trust and continue",
  "  2. Back to Agent Command Center",
].join("\n");

describe("HcTerminals.launch", () => {
  it("puts --json before the program and passes labels and parent", async () => {
    const { terminals, calls } = scripted({ run: '{"address":"t7"}' });
    const address = await terminals.launch({
      name: "bg-task-1",
      cwd: "/w",
      labels: { brigade: "main", role: "worker" },
      parent: "t3",
      argv: ["claude", "--model", "m", "Fix it"],
    });
    expect(address).toBe("t7");
    expect(calls).toEqual([
      [
        "run",
        "--json",
        "--bg",
        "--outlive-parent",
        "--name",
        "bg-task-1",
        "--cwd",
        "/w",
        "--label",
        "brigade=main",
        "--label",
        "role=worker",
        "--parent",
        "t3",
        "--",
        "claude",
        "--model",
        "m",
        "Fix it",
      ],
    ]);
  });

  it("runs with no parent and no notes when there is no parent", async () => {
    const { terminals, calls } = scripted({ run: '{"address":"t1"}' });
    await terminals.launch({ name: "bg-coordinator", cwd: "/c", labels: {}, parent: null, argv: ["claude"] });
    expect(calls[0]).toEqual([
      "run",
      "--json",
      "--bg",
      "--outlive-parent",
      "--name",
      "bg-coordinator",
      "--cwd",
      "/c",
      "--no-parent",
      "--no-notify",
      "--",
      "claude",
    ]);
  });

  it("fails loudly when hc returns no address", async () => {
    const { terminals } = scripted({ run: "{}" });
    await expect(terminals.launch({ name: "x", cwd: "/", labels: {}, parent: null, argv: ["a"] })).rejects.toThrow(
      "hc run returned no address for x",
    );
  });
});

describe("trustKey", () => {
  it("presses Down until the cursor is on yes, then Enter", () => {
    expect(trustKey(claudeOnNo, claudeTrust)).toBe("down");
    expect(trustKey(claudeOnYes, claudeTrust)).toBe("enter");
    expect(trustKey(codexPrompt, codexTrust)).toBe("enter");
  });
});

describe("HcTerminals.answerTrust", () => {
  const keys = (calls: string[][]) => calls.filter((c) => c[0] === "keys").map((c) => c[2]);

  it("moves Claude's cursor to yes, repeats a dropped press, and answers once the prompt is gone", async () => {
    const { terminals, calls } = scripted({
      read: ["booting", claudeOnNo, claudeOnNo, claudeOnYes, "› ? for shortcuts"],
    });
    expect(await terminals.answerTrust("t7", claudeTrust)).toBe("answered");
    expect(keys(calls)).toEqual(["down", "down", "enter"]);
  });

  it("presses Enter again when Codex drops the first press", async () => {
    const { terminals, calls } = scripted({ read: [codexPrompt, codexPrompt, "› Ask Codex to do anything"] });
    expect(await terminals.answerTrust("t7", codexTrust)).toBe("answered");
    expect(keys(calls)).toEqual(["enter", "enter"]);
  });

  it("stops without pressing anything once the ready text has held for 3 seconds", async () => {
    const { terminals, calls } = scripted({ read: "› ? for shortcuts" });
    expect(await terminals.answerTrust("t7", claudeTrust)).toBe("ready");
    expect(keys(calls)).toEqual([]);
    expect(calls.filter((c) => c[0] === "read")).toHaveLength(7);
  });

  it("is not fooled by Codex's ready footer flashing before its trust prompt", async () => {
    const footer = "› Ask Codex to do anything\n  ? for shortcuts";
    const { terminals, calls } = scripted({ read: [footer, footer, codexPrompt, footer] });
    expect(await terminals.answerTrust("t7", codexTrust)).toBe("answered");
    expect(keys(calls)).toEqual(["enter"]);
  });

  it("gives up after 30 seconds", async () => {
    const { terminals, calls } = scripted({ read: "booting" });
    expect(await terminals.answerTrust("t7", claudeTrust)).toBe("timeout");
    expect(calls.filter((c) => c[0] === "read")).toHaveLength(60);
  });
});

describe("HcTerminals.find", () => {
  it("lets hc match the labels, and reads the status word from either shape", async () => {
    const { terminals, calls } = scripted({
      ls: JSON.stringify({
        terminals: [
          { address: "t1", name: "bg-coordinator", status: { app: "claude", state: "idle" } },
          { address: "t3", name: "bg-task-1", status: "done" },
          { address: "t4" },
        ],
      }),
    });
    expect(await terminals.find({ brigade: "main", role: "worker" })).toEqual([
      { address: "t1", name: "bg-coordinator", status: "idle" },
      { address: "t3", name: "bg-task-1", status: "done" },
      { address: "t4", name: "", status: null },
    ]);
    expect(calls).toEqual([["ls", "--json", "--label", "brigade=main", "--label", "role=worker"]]);
  });

  it("reads a bare list too", async () => {
    const { terminals } = scripted({ ls: JSON.stringify([{ address: "t2", name: "x", status: "working" }]) });
    expect(await terminals.find({})).toEqual([{ address: "t2", name: "x", status: "working" }]);
  });
});

describe("HcTerminals.send", () => {
  const starting = 'ERR hc send failed: {"error":{"kind":"unavailable","message":"t3 is still starting"}}';
  const working = JSON.stringify({ status: { app: "claude-code", state: "working" }, turn: 4 });
  const idle = (turn: number) => JSON.stringify({ status: { app: "pi", state: "idle" }, turn });

  it("passes the text as one argument, and checks nothing more when the agent is working", async () => {
    const { terminals, calls } = scripted({ get: working });
    await terminals.send("t3", "[brigade] hello; rm -rf /");
    expect(calls).toEqual([
      ["get", "t3", "--json"],
      ["send", "t3", "[brigade] hello; rm -rf /"],
    ]);
  });

  it("retries while hc says the agent is still starting", async () => {
    const { terminals, calls } = scripted({ get: working, send: [starting, starting, ""] });
    await terminals.send("t3", "hi");
    expect(calls.filter((c) => c[0] === "send")).toHaveLength(3);
  });

  it("fails at once on any other error, and after 30 seconds of still starting", async () => {
    const lost = scripted({ get: working, send: "ERR hc send failed: not_found" });
    await expect(lost.terminals.send("t3", "hi")).rejects.toThrow("not_found");
    const slow = scripted({ get: working, send: starting });
    await expect(slow.terminals.send("t3", "hi")).rejects.toThrow("still starting");
    expect(slow.calls.filter((c) => c[0] === "send")).toHaveLength(31);
  });

  it("stops watching an idle agent once its turn starts or it is working", async () => {
    for (const after of [idle(3), JSON.stringify({ status: "working", turn: 2 })]) {
      const { terminals, calls } = scripted({ get: [idle(2), idle(2), after] });
      await terminals.send("t3", "hi");
      expect(calls.map((c) => c[0])).toEqual(["get", "send", "get", "get"]);
    }
  });

  // pi 1.5.0 kept this 16-line message in its input after the Enter was lost; one more Enter sent it.
  const piScreen = readFileSync(new URL("fixtures/pi-unsent-input.txt", import.meta.url), "utf8");
  const piText = piScreen.slice(piScreen.indexOf("[brigade]"), piScreen.indexOf("ok.") + 3);

  it("presses Enter once when no turn starts in 20 seconds and the text is still in the input", async () => {
    const { terminals, calls } = scripted({ get: idle(0), read: piScreen });
    await terminals.send("t5", piText);
    expect(calls.filter((c) => c[0] === "get")).toHaveLength(21);
    expect(calls.slice(-2)).toEqual([
      ["read", "t5", "--lines", "0"],
      ["keys", "t5", "enter"],
    ]);
  });

  it("presses nothing when the input holds other text", async () => {
    const { terminals, calls } = scripted({ get: idle(0), read: piScreen });
    await terminals.send("t5", "[brigade] From the Coordinator: add a footer.");
    expect(calls.at(-1)).toEqual(["read", "t5", "--lines", "0"]);
  });
});

describe("stillInInput", () => {
  const piScreen = readFileSync(new URL("fixtures/pi-unsent-input.txt", import.meta.url), "utf8");
  const piText = piScreen.slice(piScreen.indexOf("[brigade]"), piScreen.indexOf("ok.") + 3);
  const rule = "─".repeat(40);

  it("is yes only when the box between the last two rules holds exactly the text", () => {
    expect(stillInInput(piScreen, piText)).toBe(true);
    expect(stillInInput(piScreen, piText.replace("line 7 of", "line seven of"))).toBe(false);
    expect(stillInInput(piScreen, "Reply with the single word ok.")).toBe(false);
  });

  it("is no when the text is only in the output above and the owner's own draft is in the box", () => {
    const screen = [rule, piText, rule, rule, "my own unfinished draft", rule, "~/demo-site"].join("\n");
    expect(stillInInput(screen, piText)).toBe(false);
  });

  it("reads Claude Code's box without its prompt mark, and is no without a box", () => {
    expect(
      stillInInput([rule, "❯ [brigade] hi there", rule, "  ? for shortcuts"].join("\n"), "[brigade] hi there"),
    ).toBe(true);
    expect(stillInInput("› [brigade] hi there", "[brigade] hi there")).toBe(false);
    expect(stillInInput([rule, "", rule].join("\n"), "  ")).toBe(false);
  });
});
