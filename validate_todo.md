## Online server version check (design decision)

Decided approach: **`protocol` field for UX + strict server-side frame validation as the real gate + `MIN_PROTOCOL_VERSION` grace + no client secrets.**

### 1. Number is a UX signal, not the gate

- Add `protocol?: number` to `JoinMessage` (`shared/src/protocol.ts:457`); old clients omit it.
- Server rejects clear mismatches on `C_JOIN` with a friendly `H_ERROR`: "server runs protocol N, you have M — update."
- Add `MIN_PROTOCOL_VERSION` in addition to `PROTOCOL_VERSION` so clients one or two versions behind still get in (avoid hard-breaking active players).

### 2. Real gate = behavioral, validate the wire server-side

Server is a relay and sees every command frame. Reject frames that fail the current protocol's shape regardless of the claimed number:

- unknown `CMD_TYPE_IDS`
- envelope byte counts that don't match `envelopeLength`'s expectation
- out-of-bounds values (negative ranges, absurd coords, invalid `BIN` bytes)

This is the only thing that stops a patched old client: if the wire format changed it can't speak it correctly even after bumping the integer; if its frames still decode perfectly it's functionally compatible, so the number is just policy.

Note: `decodeEnvelope` is lenient today (`CMD_TYPES[typeId] ?? 'stop'` on unknown ids), which silently masks mismatches — tightening makes enforcement honest.

### 3. No HMAC/secret, client not authoritative

Any key in the bundle or fetched over the same socket is readable by a patched client — only stops lazy edits. Match integrity is already protected by the existing `crc32` checksums + `H_SETTINGS_ALERT` tamper watch, not by version numbers.

### 4. LAN/offline untouched by construction

Gate lives only in `online/src`; the local host never consults it.

### 5. Optional cheap win

XOR/derived encoding of the constant so `PROTOCOL_VERSION` isn't greppable in the minified bundle — stops casual patchers, honest disclaimer included.

---