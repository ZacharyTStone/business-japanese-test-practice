/**
 * Every request is counted, and every request passes the ceilings first.
 *
 * The SDK used to retry on its own: a request it retried was invisible to the
 * call ceiling, a request that ended in an exception never reached the count at
 * all, and a request that timed out — which the server may have finished and
 * billed — was never priced. The SDK now retries nothing; `llm._structured`
 * retries the same number of times, each attempt through `beginRequest`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import * as http from "../bjt/http.ts";
import * as jev from "../bjt/jev.ts";
import * as llm from "../bjt/llm.ts";
import { freshLedger } from "./conftest.ts";
import { fakeMessages, patch, setConfig, setEnv } from "./helpers.ts";

function _status(code: number, retryAfter: string | null = null): Error {
  const headers = new Headers(retryAfter ? { "retry-after": retryAfter } : {});
  return Anthropic.APIError.generate(code, undefined, `Error code: ${code}`, headers);
}

function _ok(): Record<string, any> {
  return {
    stop_reason: "end_turn", stop_details: null,
    content: [{ type: "text", text: '{"choice": 0, "reason": "x"}' }],
    usage: { input_tokens: 1000, output_tokens: 200 },
  };
}

/** `waits`: every wait between retries, instead of waiting. */
function waitsFixture(): number[] {
  const slept: number[] = [];
  patch(llm.seams, "sleep", async (seconds: number) => {
    slept.push(seconds);
  });
  return slept;
}

/** A client that raises or returns each of `replies` in turn. */
function _client(replies: unknown[]): Record<string, any>[] {
  const sent: Record<string, any>[] = [];
  fakeMessages(async (kw) => {
    sent.push(kw);
    const reply = replies[Math.min(sent.length, replies.length) - 1];
    if (reply instanceof Error) {
      throw reply;
    }
    return reply;
  });
  return sent;
}

describe("retries", () => {
  test("a transient failure is retried and every attempt counted", async () => {
    const ledger = freshLedger();
    const waits = waitsFixture();
    setConfig({ API_MAX_RETRIES: 2 });
    const sent = _client([_status(529), new Anthropic.APIConnectionError({ message: undefined }), _ok()]);
    expect((await llm.answerChoice("q", ["a", "b"], { model: "claude-sonnet-5" }))["choice"]).toBe(0);
    expect(sent.length).toBe(3);
    expect(ledger.attempts, "every request sent is on the count").toBe(3);
    expect(ledger.calls, "one response was priced").toBe(1);
    expect(waits.length).toBe(2);
  });

  test("the retry budget is the configured one", async () => {
    const ledger = freshLedger();
    waitsFixture();
    setConfig({ API_MAX_RETRIES: 2 });
    const sent = _client([_status(503)]);
    await expect(llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" })).rejects.toThrow(llm.LLMError);
    expect(sent.length === 3 && ledger.attempts === 3).toBe(true);
  });

  test("a request that can never succeed is not retried", async () => {
    freshLedger();
    const waits = waitsFixture();
    const sent = _client([_status(400)]);
    await expect(llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" })).rejects.toThrow(llm.LLMError);
    expect(sent.length).toBe(1);
    expect(waits).toEqual([]);
  });

  test("an empty account is not retried", async () => {
    freshLedger();
    waitsFixture();
    const broke = Anthropic.APIError.generate(
      400, undefined, "Your credit balance is too low to access the Anthropic API.", new Headers());
    const sent = _client([broke]);
    await expect(llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" })).rejects.toThrow(llm.LLMBillingError);
    expect(sent.length).toBe(1);
  });

  test("the call ceiling counts requests not responses", async () => {
    // Two failed requests are two requests: the third is refused before it
    // is sent, retry or not.
    freshLedger();
    waitsFixture();
    setConfig({ RUN_MAX_CALLS: 2, API_MAX_RETRIES: 5 });
    const sent = _client([_status(529)]);
    const err = await llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMSpendLimitError);
    expect(sent.length).toBe(2);
    expect((err as Error).message).toContain("call ceiling");
  });

  test("every retry passes the ceilings first", async () => {
    // The minute ceiling reached while waiting to retry stops the retry.
    const ledger = freshLedger();
    waitsFixture();
    setConfig({ RUN_MAX_MINUTES: 30 });

    patch(llm.seams, "sleep", async () => {
      ledger.started -= 31 * 60;
    });
    const sent = _client([_status(529), _ok()]);
    await expect(llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" })).rejects.toThrow(llm.LLMSpendLimitError);
    expect(sent.length).toBe(1);
  });

  test("a timed out request is priced at its ceiling", async () => {
    const ledger = freshLedger();
    waitsFixture();
    setConfig({ API_MAX_RETRIES: 0 });
    _client([new Anthropic.APIConnectionTimeoutError()]);
    await expect(llm.answerChoice("q".repeat(100), ["a"], { model: "claude-sonnet-5" })).rejects.toThrow(llm.LLMError);
    expect(ledger.calls).toBe(1);
    expect(ledger.output_tokens, "answerChoice's whole output ceiling").toBe(1500);
    expect(ledger.usd).toBeGreaterThanOrEqual(1500 * 10 / 1_000_000);
  });

  test("the servers retry after is honoured when short", async () => {
    freshLedger();
    const waits = waitsFixture();
    setConfig({ API_MAX_RETRIES: 1 });
    _client([_status(429, "3"), _ok()]);
    await llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" });
    expect(waits).toEqual([3.0]);
  });

  test("a jev request is counted before it is sent", async () => {
    const ledger = freshLedger();
    setEnv("TYPESAFE_API_KEY", "k");
    patch(http.seams, "open", async () => {
      throw new http.OSError("down");
    });
    await expect(jev.choiceProbabilities("q", ["a", "b"], { model: "jev-latest" })).rejects.toThrow(llm.LLMError);
    expect(ledger.attempts === 1 && ledger.calls === 0).toBe(true);
  });

  // ----- what counts as a failed call ------------------------------------------

  test("a request this sdk cannot make is a crash not an outage", async () => {
    // An SDK too old for output_config raises a TypeError on every call.
    // Wrapped as an LLMError it read as an outage, and every tolerant call site
    // (the proofreader, the probe) turned a broken run into a quiet one.
    freshLedger();
    const waits = waitsFixture();
    _client([new TypeError("Messages.create() got an unexpected keyword argument "
                           + "'output_config'")]);
    const err = await llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(llm.LLMError);
    expect(waits).toEqual([]);
  });

  test("no credentials is a failed call", async () => {
    // The SDK reports a missing key as a plain error rather than as one of
    // its API errors (Python's SDK raises a TypeError); that one is an
    // outage, so a probe without a key reports unmeasured as documented.
    freshLedger();
    waitsFixture();
    _client([new Error('"Could not resolve authentication method. Expected one of '
                       + 'api_key, auth_token, or credentials to be set."')]);
    await expect(llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" })).rejects.toThrow(llm.LLMError);
  });
});
