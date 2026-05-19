import { SHARE_CODE_LENGTH } from "@/lib/constants";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newShareCode(): string {
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_CODE_LENGTH));
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
