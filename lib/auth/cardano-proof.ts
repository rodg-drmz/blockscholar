import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import * as CMS from '@emurgo/cardano-message-signing-nodejs';
import type { CardanoNetwork } from '@/lib/cardano/network';
export function paymentIdentity(address: string, network: CardanoNetwork): { address: string; ownerKeyHash: string; addressHex: string } {
  const parsed = CSL.Address.from_bech32(address);
  if (parsed.network_id() !== (network === 'mainnet' ? 1 : 0)) throw new Error('Wallet network does not match the requested network.');
  const cred = CSL.BaseAddress.from_address(parsed)?.payment_cred() ?? CSL.EnterpriseAddress.from_address(parsed)?.payment_cred();
  const key = cred?.to_keyhash();
  if (!key) throw new Error('Use a Cardano payment-key wallet address.');
  return { address: parsed.to_bech32(), ownerKeyHash: key.to_hex(), addressHex: parsed.to_hex() };
}

export async function verifyBadgeWalletSignature(address: string, payloadHex: string, proof: { key: string; signature: string }, network: CardanoNetwork): Promise<boolean> {
  try {
    if (!/^[a-f0-9]{2,4096}$/i.test(proof.key) || !/^[a-f0-9]{2,16384}$/i.test(proof.signature)) return false;
    const owner = paymentIdentity(address, network);
    const coseKey = CMS.COSEKey.from_bytes(Buffer.from(proof.key, 'hex'));
    const cose = CMS.COSESign1.from_bytes(Buffer.from(proof.signature, 'hex'));
    const label = (n: number) => CMS.Label.new_int(CMS.Int.new_i32(n));
    if (coseKey.key_type().as_int()?.as_i32() !== 1 || coseKey.algorithm_id()?.as_int()?.as_i32() !== -8 || coseKey.header(label(-1))?.as_int()?.as_i32() !== 6) return false;
    const bytes = coseKey.header(label(-2))?.as_bytes();
    if (!bytes || bytes.length !== 32) return false;
    const publicKey = CSL.PublicKey.from_bytes(bytes);
    if (publicKey.hash().to_hex() !== owner.ownerKeyHash) return false;
    const protectedHeaders = cose.headers().protected().deserialized_headers();
    if (protectedHeaders.algorithm_id()?.as_int()?.as_i32() !== -8) return false;
    const signedAddress = protectedHeaders.header(CMS.Label.new_text('address'))?.as_bytes();
    if (!signedAddress || Buffer.from(signedAddress).toString('hex') !== owner.addressHex) return false;
    if (cose.headers().unprotected().header(CMS.Label.new_text('hashed'))?.as_special()?.as_bool() === true) return false;
    const payload = cose.payload();
    if (!payload || Buffer.from(payload).toString('hex') !== payloadHex) return false;
    return publicKey.verify(cose.signed_data().to_bytes(), CSL.Ed25519Signature.from_bytes(cose.signature()));
  } catch { return false; }
}
