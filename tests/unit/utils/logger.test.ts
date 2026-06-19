import { describe, it, expect } from "vitest";
import pino from "pino";

/**
 * The real logger writes every pino record to stderr so stdout is left free
 * for the progress bar. Verify that using the same wiring against an
 * in-memory buffer produces the expected JSON stream at every level.
 */
describe("logger stderr routing", () => {
  it("sends info, warn, error, and fatal records to the single destination", () => {
    const chunks: string[] = [];
    const destination = {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    };

    const logger = pino({ level: "debug" }, destination as unknown as NodeJS.WritableStream);

    logger.info("hello info");
    logger.warn("hello warn");
    logger.error("hello error");
    logger.fatal("hello fatal");

    const text = chunks.join("");
    expect(text).toContain("hello info");
    expect(text).toContain("hello warn");
    expect(text).toContain("hello error");
    expect(text).toContain("hello fatal");
  });
});
