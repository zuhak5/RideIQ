import { assertEquals } from 'jsr:@std/assert';
import { shaHex } from '../_shared/crypto.ts';

// PayDollar / AsiaPay Secure Hash example from the PayDollar PayGate Integration Guide.
// Signing data string: Merchant ID|Merchant Reference|Currency Code|Amount|Payment Type|Secure Hash Secret
// Expected SHA-1: 13068c0ef09139ea711d36bde16785a2d30b9a30
// (This test guards against accidental changes in our hashing implementation.)

Deno.test('AsiaPay SecureHash example (SHA-1) matches PayDollar guide', async () => {
  const secret = 'gMAVIEGVpqHvxoNEqbrZRuBDFT1B0icW';
  const signing = `56100908|1280204670187|344|10|N|${secret}`;
  const digest = await shaHex('SHA-1', signing);
  assertEquals(digest, '13068c0ef09139ea711d36bde16785a2d30b9a30');
});
