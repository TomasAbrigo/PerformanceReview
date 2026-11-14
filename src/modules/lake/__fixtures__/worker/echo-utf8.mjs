// Test double of scripts/ingest-upload.ts: answers with a response over 64 KiB
// whose first chunk ends in the middle of a two-byte character ("é").
const text = `${"é".repeat(40_000)}ñ€`;
const answer = Buffer.from(`${JSON.stringify({ ok: true, text })}\n`);
// The JSON prefix is an odd number of bytes, so every "é" starts at an odd
// offset: cutting at an even one splits a character.
const cut = 65_536;

process.stdout.write(answer.subarray(0, cut));
setTimeout(() => process.stdout.write(answer.subarray(cut)), 100);
