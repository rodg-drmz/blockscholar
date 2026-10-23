import { ed25519 } from '@noble/curves/ed25519';
import { verifySignature as verifyMidnightSignature, addressFromKey } from '@midnight-ntwrk/ledger-v8';
import { getAddress, isAddress, verifyMessage } from 'viem';
import {
  paymentIdentity,
  verifyBadgeWalletSignature,
} from '@/lib/auth/cardano-proof';
import type { LearnWalletChain } from '@/lib/auth/learn-identity-store';

export type WalletProof =
  | { chain: 'cardano'; key: string; signature: string }
  | { chain: 'midnight'; data: string; signature: string; verifyingKey: string; scheme?: string }
  | { chain: 'ethereum'; signature: `0x${string}` }
  | { chain: 'solana'; signature: string };

export type VerifiedWalletProof = {
  chain: LearnWalletChain;
  key: string;
  address: string;
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value: string): Uint8Array {
  if (!value || value.length > 128) throw new Error('Invalid base58 value');
  let number = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('Invalid base58 value');
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.push(Number(number & 0xffn));
    number >>= 8n;
  }
  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function cardanoNetwork(address: string): 'mainnet' | 'preprod' {
  return address.toLowerCase().startsWith('addr1') ? 'mainnet' : 'preprod';
}

export async function verifyLearnWalletProof(input: {
  chain: LearnWalletChain;
  address: string;
  message: string;
  payloadHex: string;
  proof: WalletProof;
}): Promise<VerifiedWalletProof | null> {
  const { chain, address, message, payloadHex, proof } = input;
  if (proof.chain !== chain) return null;

  try {
    if (chain === 'cardano' && proof.chain === 'cardano') {
      const network = cardanoNetwork(address);
      if (
        !(await verifyBadgeWalletSignature(
          address,
          payloadHex,
          { key: proof.key, signature: proof.signature },
          network,
        ))
      ) {
        return null;
      }
      const owner = paymentIdentity(address, network);
      return { chain, key: owner.ownerKeyHash, address: owner.address };
    }

    if (chain === 'ethereum' && proof.chain === 'ethereum') {
      if (!isAddress(address, { strict: false })) return null;
      const normalized = getAddress(address);
      const valid = await verifyMessage({
        address: normalized,
        message,
        signature: proof.signature,
      });
      return valid ? { chain, key: normalized.toLowerCase(), address: normalized } : null;
    }

    if (chain === 'solana' && proof.chain === 'solana') {
      const publicKey = decodeBase58(address);
      if (publicKey.length !== 32) return null;
      const signature = Buffer.from(proof.signature, 'base64');
      if (signature.length !== 64) return null;
      const valid = ed25519.verify(signature, new TextEncoder().encode(message), publicKey);
      return valid ? { chain, key: address, address } : null;
    }

    if (chain === 'midnight' && proof.chain === 'midnight') {
      if (
        (proof.scheme !== undefined && proof.scheme !== 'schnorr_bip340') ||
        !/^[a-f0-9]{64}$/i.test(proof.verifyingKey) ||
        !/^[a-f0-9]{128}$/i.test(proof.signature)
      ) {
        return null;
      }
      // Connector signData prefixes messages so a login can never masquerade as
      // a transaction signature. Compute the preimage from the server challenge,
      // never from the wallet-supplied `data` field (whose encoding varies).
      const bytes = new TextEncoder().encode(message);
      const signedMessage = new TextEncoder().encode(`midnight_signed_message:${bytes.byteLength}:${message}`);
      const { MidnightBech32m, UnshieldedAddress } = await import('@midnight-ntwrk/wallet-sdk-address-format');
      const parsed = MidnightBech32m.parse(address);
      const owner = parsed.decode(UnshieldedAddress, parsed.network);
      if (owner.hexString !== addressFromKey(proof.verifyingKey.toLowerCase())) return null;
      const valid = verifyMidnightSignature(
        proof.verifyingKey,
        signedMessage,
        proof.signature,
      );
      return valid
        ? {
            chain,
            key: proof.verifyingKey.toLowerCase(),
            address,
          }
        : null;
    }
  } catch {
    return null;
  }

  return null;
}
