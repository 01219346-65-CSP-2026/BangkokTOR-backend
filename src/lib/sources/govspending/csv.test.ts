import { describe, expect, test } from "bun:test";
import { csvRecords, parseCsv } from "./csv.ts";

async function* chunksOf(...parts: string[]) {
  for (const p of parts) yield p;
}

async function rows(...parts: string[]) {
  const out: string[][] = [];
  for await (const r of parseCsv(chunksOf(...parts))) out.push(r);
  return out;
}

describe("parseCsv", () => {
  test("plain rows, LF and CRLF", async () => {
    expect(await rows("a,b\n1,2\r\n3,4\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  test("quoted commas, newlines and escaped quotes", async () => {
    expect(await rows('x,"a, b","line1\nline2","say ""hi"""\n')).toEqual([
      ["x", "a, b", "line1\nline2", 'say "hi"'],
    ]);
  });

  test("a leading BOM is not part of the first header", async () => {
    expect((await rows("﻿ลำดับ,รหัสโครงการ\n"))[0]![0]).toBe("ลำดับ");
  });

  test("chunk boundaries anywhere — mid-field, mid-escape, between CR and LF", async () => {
    const whole = 'a,"q""x",c\r\n1,"2\n3",4\n';
    const expected = await rows(whole);
    for (let cut = 1; cut < whole.length; cut++) {
      expect(await rows(whole.slice(0, cut), whole.slice(cut))).toEqual(expected);
    }
  });

  test("a last row without a trailing newline is kept", async () => {
    expect(await rows("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("a bare quote mid-field is literal text, not the start of a quoted field", async () => {
    // The real shape: …CHALLENGE "x" in an unquoted project name. Read as an
    // opener, it swallowed every row up to the next quote.
    expect(await rows('1,ประกวด CAMPAIGN "MWA" 2569,x\n2,ถัดไป,y\n')).toEqual([
      ["1", 'ประกวด CAMPAIGN "MWA" 2569', "x"],
      ["2", "ถัดไป", "y"],
    ]);
  });

  test("a quote at field start still opens a quoted field", async () => {
    expect(await rows('"a,b" tail,c\n')).toEqual([["a,b tail", "c"]]);
  });

  test("empty fields survive", async () => {
    expect(await rows(",,\n")).toEqual([["", "", ""]]);
  });
});

describe("csvRecords", () => {
  const collect = async (text: string) => {
    const out: Record<string, string>[] = [];
    for await (const r of csvRecords(chunksOf(text))) out.push(r);
    return out;
  };

  test("a row split by a raw newline is stitched back together", async () => {
    // 2569-egp-contract-1.csv: a 6-value row then a 23-value row, one record.
    const out = await collect("a,b,c,d\n1,ป้ายหน่วยเลือกตั้\nง,x,y\n2,ok,p,q\n");
    expect(out).toEqual([
      { a: "1", b: "ป้ายหน่วยเลือกตั้\nง", c: "x", d: "y" },
      { a: "2", b: "ok", c: "p", d: "q" },
    ]);
  });

  test("a short row that nothing completes is kept, padded", async () => {
    expect(await collect("a,b,c\n1,2\n3,4,5\n")).toEqual([
      { a: "1", b: "2", c: "" },
      { a: "3", b: "4", c: "5" },
    ]);
  });

  test("keys rows by the trimmed header and skips blank lines", async () => {
    const out: Record<string, string>[] = [];
    for await (const r of csvRecords(chunksOf(" id ,name\n\n1,ก\n2,ข\n"))) out.push(r);
    expect(out).toEqual([{ id: "1", name: "ก" }, { id: "2", name: "ข" }]);
  });
});
