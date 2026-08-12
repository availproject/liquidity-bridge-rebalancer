import { Keyring } from "avail-js-sdk";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";

const isMainnet = process.env.CONFIG === "Mainnet";
const evmPoolSeed = process.env.EVM_POOL_SEED ?? process.env.WALLET_SIGNER_KEY_ETH;

if (!evmPoolSeed) {
  throw new Error("Missing EVM_POOL_SEED or WALLET_SIGNER_KEY_ETH");
}

//read based clients
export const publicClient = createPublicClient({
  chain: isMainnet ? mainnet : sepolia,
  transport: http(process.env.ETH_RPC_URL),
});

export const baseClient = createPublicClient({
  chain: isMainnet ? base : baseSepolia,
  transport: http(process.env.BASE_RPC_URL),
});

//write based clients
export const evmAccount = privateKeyToAccount(evmPoolSeed as `0x${string}`);

export const walletClient = createWalletClient({
  account: evmAccount, // Include account here
  chain: isMainnet ? mainnet : sepolia,
  transport: http(process.env.ETH_RPC_URL),
});

export const availAccount = process.env.AVAIL_POOL_SEED
  ? new Keyring({ type: "sr25519" }).addFromUri(process.env.AVAIL_POOL_SEED)
  : (undefined as any);
