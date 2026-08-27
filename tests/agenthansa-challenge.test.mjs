import assert from "node:assert/strict";
import test from "node:test";
import { solveAgentHansaChallenge } from "../scripts/agenthansa-challenge.mjs";

test("solves a more-than relationship", () => {
  assert.equal(
    solveAgentHansaChallenge(
      "A cat has 20 berries. A dolphin has 3 more than the cat. How many berries does the dolphin have?",
    ),
    23,
  );
});

test("solves a fewer-than relationship", () => {
  assert.equal(
    solveAgentHansaChallenge(
      "A fox has twelve coins. An owl has three fewer than the fox. How many coins does the owl have?",
    ),
    9,
  );
});

test("solves sequential gains and losses", () => {
  assert.equal(
    solveAgentHansaChallenge("A parrot has 5 coins. It gains 3, loses 2. How many remain?"),
    6,
  );
});
