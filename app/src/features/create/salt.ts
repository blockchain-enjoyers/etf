/** 32-byte hex salt for a CREATE2 deploy; generated once per wizard session. */
export function randomSalt(): `0x${string}` {
  return ("0x" +
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}
