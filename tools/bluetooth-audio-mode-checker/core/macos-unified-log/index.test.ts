import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  consumeUtf8Lines,
  formatUnifiedLogStart,
  parseUnifiedLogTimestamp,
} from "./index.ts";

test("系统日志起点使用本机日志命令接受的格式", () => {
  const timestamp = new Date(2026, 6, 22, 9, 8, 7).getTime();
  assert.equal(formatUnifiedLogStart(timestamp), "2026-07-22 09:08:07");
});

test("系统日志行时间转换为标准时间", () => {
  const result = parseUnifiedLogTimestamp(
    "2026-07-22 09:08:07.123456+0800 coreaudiod: Current profile tsco",
  );
  assert.equal(result, new Date("2026-07-22T09:08:07.123").toISOString());
});

test("跨数据块的文本和末尾无换行文本都只交付一次", async () => {
  const stream = new PassThrough();
  const lines: string[] = [];
  consumeUtf8Lines(stream, (line) => lines.push(line));

  stream.write("第一行\n第二");
  stream.write("行\n末行");
  stream.end();
  await new Promise<void>((resolve) => stream.once("end", resolve));

  assert.deepEqual(lines, ["第一行", "第二行", "末行"]);
});
