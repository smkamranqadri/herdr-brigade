import { describe, expect, it } from "vitest";
import { HcTerminals } from "./hcTerminals.ts";

function scripted(replies: Record<string, string | string[]>) {
  const calls: string[][] = [];
  const queues = new Map(Object.entries(replies).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const run = (args: readonly string[]) => {
    calls.push([...args]);
    const q = queues.get(args[0] ?? "");
    const reply = q && q.length > 1 ? q.shift() : q?.[0];
    return Promise.resolve(reply ?? "");
  };
  let clock = 0;
  const terminals = new HcTerminals({ run, sleep: (ms) => ((clock += ms), Promise.resolve()), now: () => clock });
  return { terminals, calls };
}

const claudeTrust = { text: "trust this folder", keys: ["down", "enter"], ready: ["? for shortcuts"] };

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

describe("HcTerminals.answerTrust", () => {
  it("presses the answer keys once the prompt shows", async () => {
    const { terminals, calls } = scripted({ read: ["booting", "Quick safety check: Yes, I trust this folder"] });
    expect(await terminals.answerTrust("t7", claudeTrust)).toBe("answered");
    expect(calls.filter((c) => c[0] === "keys")).toEqual([["keys", "t7", "down", "enter"]]);
  });

  it("stops without pressing anything once the agent is ready", async () => {
    const { terminals, calls } = scripted({ read: "› ? for shortcuts" });
    expect(await terminals.answerTrust("t7", claudeTrust)).toBe("ready");
    expect(calls.filter((c) => c[0] === "keys")).toEqual([]);
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
  it("passes the text as one argument", async () => {
    const { terminals, calls } = scripted({});
    await terminals.send("t3", "[brigade] hello; rm -rf /");
    expect(calls).toEqual([["send", "t3", "[brigade] hello; rm -rf /"]]);
  });
});
