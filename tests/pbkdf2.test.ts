import { describe, expect, it } from 'vitest'
import { pbkdf2Sha256Hex } from '../client/src/net/pbkdf2.ts'

describe('pbkdf2-sha256 secure-context fallback', () => {
  it('matches the standard PBKDF2-HMAC-SHA256 vectors', () => {
    expect(pbkdf2Sha256Hex('password', 'salt', 1, 32)).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    )
    expect(pbkdf2Sha256Hex('password', 'salt', 2, 32)).toBe(
      'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43',
    )
    expect(pbkdf2Sha256Hex('password', 'salt', 4096, 32)).toBe(
      'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a',
    )
  })

  it('produces the same hash as the host passphrase flow', () => {
    expect(pbkdf2Sha256Hex('changeme', 'space-arenas:ABCD', 100000, 32)).toBe(
      '85e816661f331ac03ece17dbca5ffad53e960e5d581de28b1b68642f0c436ea3',
    )
    expect(pbkdf2Sha256Hex('', 'space-arenas:ABCD', 100000, 32)).toBe(
      '9d67aae2e6c0b0cbf9a4c4495a7be447eff8a68ea88ed8fbb67e595eea7d5298',
    )
  })
})
