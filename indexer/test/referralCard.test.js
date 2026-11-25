import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderReferralCard,
  renderReferralMeta,
  sanitizeReferralField,
} from "../src/referralCard.js";

describe("referral share cards", () => {
  it("renders a 1200x630 PNG with a valid signature", () => {
    const png = renderReferralCard({ name: "ALICE", earnings: "12.50", ref: "GABC" });
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    assert.ok(png.length > 2000);
  });

  it("varies the image with the supplied name and earnings", () => {
    const alice = renderReferralCard({ name: "ALICE", earnings: "12.50", ref: "GABC" });
    const bob = renderReferralCard({ name: "BOB", earnings: "99.00", ref: "GABC" });
    assert.notEqual(alice.toString("base64"), bob.toString("base64"));
  });

  it("includes dynamic OpenGraph and Twitter tags", () => {
    const html = renderReferralMeta({
      name: "Alice",
      earnings: "12.50",
      ref: "GABC",
      appUrl: "https://example.com/referrals?ref=GABC",
      imageUrl: "https://example.com/og.png?name=Alice",
    });
    assert.ok(html.includes('og:title" content="Alice invites you to iPredict'));
    assert.ok(html.includes('og:image" content="https://example.com/og.png?name=Alice'));
    assert.ok(html.includes("summary_large_image"));
    assert.ok(html.includes('og:image:width" content="1200'));
    assert.ok(html.includes("window.location.replace"));
  });

  it("escapes user-supplied HTML", () => {
    const html = renderReferralMeta({
      name: "<script>alert(1)</script>",
      earnings: "0",
      ref: "GABC",
      appUrl: "https://example.com/referrals?ref=GABC",
      imageUrl: "https://example.com/og.png",
    });
    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("sanitizes and bounds referral fields", () => {
    assert.equal(sanitizeReferralField("  a\u0000b  ", 10, "x"), "ab");
    assert.equal(sanitizeReferralField("", 10, "x"), "x");
    assert.equal(sanitizeReferralField("abcdefghijkl", 5, "x"), "abcde");
  });
});
