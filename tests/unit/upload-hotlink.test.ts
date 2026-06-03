import { afterEach, describe, expect, it } from "vitest";
import { isBlockedHotlink } from "@/lib/uploads/hotlink";

const originalAllowedOrigins = process.env.UPLOAD_HOTLINK_ALLOWED_ORIGINS;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

describe("upload hotlink guard", () => {
  afterEach(() => {
    process.env.UPLOAD_HOTLINK_ALLOWED_ORIGINS = originalAllowedOrigins;
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("allows the public host header when the internal request URL is localhost", () => {
    const request = new Request("http://localhost:3000/uploads/editor/peril.webp", {
      headers: {
        host: "124.221.123.13:3000",
        referer: "http://124.221.123.13:3000/word/peril"
      }
    });

    expect(isBlockedHotlink(request)).toBe(false);
  });

  it("allows forwarded https origins behind a proxy", () => {
    const request = new Request("http://localhost:3000/uploads/editor/peril.webp", {
      headers: {
        "x-forwarded-host": "mnemonic.example.com",
        "x-forwarded-proto": "https",
        referer: "https://mnemonic.example.com/word/peril"
      }
    });

    expect(isBlockedHotlink(request)).toBe(false);
  });

  it("blocks unrelated referer origins", () => {
    const request = new Request("http://localhost:3000/uploads/editor/peril.webp", {
      headers: {
        host: "124.221.123.13:3000",
        referer: "https://example.net/article"
      }
    });

    expect(isBlockedHotlink(request)).toBe(true);
  });

  it("allows explicitly configured extra origins", () => {
    process.env.UPLOAD_HOTLINK_ALLOWED_ORIGINS = "https://cards.example.com";
    const request = new Request("http://localhost:3000/uploads/editor/peril.webp", {
      headers: {
        host: "124.221.123.13:3000",
        referer: "https://cards.example.com/share"
      }
    });

    expect(isBlockedHotlink(request)).toBe(false);
  });
});
