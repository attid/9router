import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getComboMembersFromData,
  getComboModelsFromData,
  getRotatedModels,
  handleComboChat,
  resetComboRotation,
} from "../../open-sse/services/combo.js";
import {
  getComboModelsFromData as getCompactComboModelsFromData,
  handleComboChat as handleCompactComboChat,
} from "../../open-sse/services/compact.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

async function firstChoices(models, count, stickyLimit = 1) {
  const choices = [];
  for (let i = 0; i < count; i++) {
    const handleSingleModel = vi.fn(async () => new Response("ok"));
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hello" }] },
      models,
      handleSingleModel,
      log,
      comboName: "weighted-combo",
      comboStrategy: "round-robin",
      comboStickyLimit: stickyLimit,
    });
    choices.push(handleSingleModel.mock.calls[0][1]);
  }
  return choices;
}

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });

  it("rotates positive weights deterministically", async () => {
    const models = [
      { model: "provider/a", weight: 2 },
      { model: "provider/b", weight: 1 },
    ];

    await expect(firstChoices(models, 6)).resolves.toEqual([
      "provider/a", "provider/b", "provider/a",
      "provider/a", "provider/b", "provider/a",
    ]);
  });

  it("applies sticky limits as calls per model while retaining weights", async () => {
    const models = [
      { model: "provider/a", weight: 2 },
      { model: "provider/b", weight: 1 },
    ];

    await expect(firstChoices(models, 6, 2)).resolves.toEqual([
      "provider/a", "provider/a", "provider/b", "provider/b", "provider/a", "provider/a",
    ]);
  });

  it("keeps the legacy combo lookup API returning model names", () => {
    const combos = [{ name: "mixed", models: [
      " provider/legacy ",
      { model: " provider/weighted ", weight: 4 },
    ] }];

    expect(getComboModelsFromData("mixed", combos)).toEqual([
      "provider/legacy",
      "provider/weighted",
    ]);
    expect(getComboMembersFromData("mixed", combos)).toEqual([
      { model: "provider/legacy", weight: 1 },
      { model: "provider/weighted", weight: 4 },
    ]);
  });

  it("normalizes structured members in the compact compatibility service", async () => {
    const combos = [{ name: "free-combo", models: [
      " provider/base ",
      { model: " provider/overlay ", weight: 0 },
    ] }];
    expect(getCompactComboModelsFromData("free-combo", combos)).toEqual([
      "provider/base",
      "provider/overlay",
    ]);

    const tried = [];
    await handleCompactComboChat({
      body: {},
      models: combos[0].models,
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        throw new Error("next");
      },
      log,
    });
    expect(tried).toEqual(["provider/base", "provider/overlay"]);
  });

  it("keeps zero-weight models after the positive pool in fallback strategy", async () => {
    const tried = [];
    await handleComboChat({
      body: {},
      models: [
        { model: "provider/zero-first", weight: 0 },
        { model: "provider/positive", weight: 2 },
        { model: "provider/zero-last", weight: 0 },
      ],
      handleSingleModel: async (_body, model) => { tried.push(model); throw new Error("next"); },
      log,
      comboName: "fallback-zero",
      comboStrategy: "fallback",
    });

    expect(tried).toEqual(["provider/positive", "provider/zero-first", "provider/zero-last"]);
  });

  it("uses zero-weight models only after every weighted fallback", async () => {
    const tried = [];
    await handleComboChat({
      body: {},
      models: [
        { model: "provider/a", weight: 1 },
        { model: "provider/zero", weight: 0 },
        { model: "provider/b", weight: 1 },
      ],
      handleSingleModel: async (_body, model) => { tried.push(model); throw new Error("next"); },
      log,
      comboName: "round-robin-zero",
      comboStrategy: "round-robin",
    });

    expect(tried).toEqual(["provider/a", "provider/b", "provider/zero"]);
  });

  it("lets capacity auto-switch reorder a structured weighted try list", async () => {
    const tried = [];
    await handleComboChat({
      body: { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }] },
      models: [
        { model: "deepseek/deepseek-chat", weight: 3 },
        { model: "anthropic/claude-sonnet-4.6", weight: 1 },
        { model: "deepseek/deepseek-reasoner", weight: 0 },
      ],
      handleSingleModel: async (_body, model) => { tried.push(model); return new Response("ok"); },
      log,
      comboName: "vision-weighted",
      comboStrategy: "round-robin",
    });

    expect(tried[0]).toBe("anthropic/claude-sonnet-4.6");
  });

  it("does not promote a zero-weight model during capability auto-switch", async () => {
    const tried = [];
    await handleComboChat({
      body: { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }] },
      models: [
        { model: "deepseek/deepseek-chat", weight: 1 },
        { model: "anthropic/claude-sonnet-4.6", weight: 0 },
      ],
      handleSingleModel: async (_body, model) => { tried.push(model); throw new Error("next"); },
      log,
      comboName: "vision-fallback-only",
      comboStrategy: "round-robin",
    });

    expect(tried).toEqual([
      "deepseek/deepseek-chat",
      "anthropic/claude-sonnet-4.6",
    ]);
  });
});
