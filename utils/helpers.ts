import {
  ApiPromise,
  Keyring,
  KeyringPair,
  SubmittableResult,
} from "avail-js-sdk";
import {
  IChain,
  SendMessageTypedData,
  WithBalanceData,
  TxnReturnType,
  ExecuteMessageTypedData,
  ContractAvailSendTypedData,
  ContractReceiveAvailTypedData,
  TransactionStatus,
  MessageSentEventArgs,
  AccountAndStorageProof,
} from "./types";
import { BigNumber } from "bignumber.js";
import { baseClient, publicClient, walletClient } from "./client";
import { availTokenAbi, bridgeContractAbi, messageSentEvent } from "./abi";
import {
  decodeEventLog,
  encodeAbiParameters,
  Hex,
  keccak256,
  PublicClient,
  WalletClient,
} from "viem";

import jsonbigint from "json-bigint";

const JSONBigInt = jsonbigint({ useNativeBigInt: true });

//api / rpc based get helpers
export async function getMerkleProof(blockhash: string, index: number) {
  const res = await fetch(
    `${process.env.BRIDGE_API_URL}/v1/eth/proof/${blockhash}?index=${index}`,
  ).catch(() => Response.error());

  if (!res || !res.ok) {
    throw new Error(`Failed to fetch proof: ${res?.status} ${res?.statusText}`);
  }

  const text = await res.text();
  const proof = JSONBigInt.parse(text);
  return proof as ContractReceiveAvailTypedData;
}

export async function getAccountStorageProofs(
  blockhash: string,
  messageid: number,
) {
  const response = await fetch(
    `${process.env.BRIDGE_API_URL}/v1/avl/proof/${blockhash}/${messageid}`,
  ).catch((e) => {
    return Response.error();
  });

  const result: AccountAndStorageProof =
    (await response.json()) as AccountAndStorageProof;
  return result;
}

export async function getTokenBalance(
  api: ApiPromise,
  availAddress?: String,
  evmAddress?: Hex,
) {
  const balance = (await api.query.system.account(
    availAddress ?? process.env.AVAIL_POOL_ADDRESS,
  )) as WithBalanceData<any>;

  const { free, frozen } = balance.data;

  const freeBalance = new BigNumber(free.toString());
  const frozenBalance = new BigNumber(frozen.toString());
  const spendableBalance = freeBalance.minus(frozenBalance);

  const basePoolBalance = await baseClient.readContract({
    address: process.env.AVAIL_TOKEN_BASE as Hex,
    abi: availTokenAbi,
    functionName: "balanceOf",
    args: [evmAddress ?? (process.env.EVM_POOL_ADDRESS as Hex)],
  });

  const gasCheckBase = await baseClient.getBalance({
    address: evmAddress ?? (process.env.EVM_POOL_ADDRESS as Hex),
  });

  const gasCheckEthereum = await publicClient.getBalance({
    address: evmAddress ?? (process.env.EVM_POOL_ADDRESS as Hex),
  });

  return {
    basePoolBalance: new BigNumber(basePoolBalance),
    gasCheckBase: new BigNumber(gasCheckBase),
    gasCheckEthereum: new BigNumber(gasCheckEthereum),
    availPoolBalance: spendableBalance,
    humanFormatted: {
      basePoolBalance: new BigNumber(basePoolBalance)
        .dividedBy(10 ** 18)
        .toFixed(4),
      gasCheckBase: new BigNumber(gasCheckBase).dividedBy(10 ** 18).toFixed(4),
      gasCheckEthereum: new BigNumber(gasCheckEthereum)
        .dividedBy(10 ** 18)
        .toFixed(4),
      availPoolBalance: spendableBalance.dividedBy(10 ** 18).toFixed(4),
    },
  };
}

//extrinsic / contract based write helpers
export async function sendMessage(
  account: KeyringPair,
  api: ApiPromise,
  data: SendMessageTypedData,
): Promise<TxnReturnType<SubmittableResult["status"]>> {
  const txResult = await new Promise<SubmittableResult>((resolve) => {
    api.tx.vector
      .sendMessage(data.message, data.to, data.destinationDomain)
      .signAndSend(account, (result: SubmittableResult) => {
        console.log(`Tx status: ${result.status}`);
        if (result.isFinalized || result.isError) {
          resolve(result);
        }
      });
  });

  const error = txResult.dispatchError;
  if (txResult.isError) {
    throw new Error(`Transaction failed with error: ${error}`);
  } else if (error != undefined) {
    if (error.isModule) {
      const decoded = api.registry.findMetaError(error.asModule);
      const { docs, name, section } = decoded;
      throw new Error(`${section}.${name}: ${docs.join(" ")}`);
    } else {
      throw new Error(error.toString());
    }
  }

  return {
    status: txResult.status,
    txHash: txResult.txHash.toString(),
  };
}

export async function executeMessage(
  account: KeyringPair,
  api: ApiPromise,
  data: ExecuteMessageTypedData,
): Promise<TxnReturnType<SubmittableResult["status"]>> {
  const txResult = await new Promise<SubmittableResult>((resolve) => {
    api.tx.vector
      .execute(
        data.slot,
        data.addrMessage,
        data.accountProof,
        data.storageProof,
      )
      .signAndSend(account, (result: SubmittableResult) => {
        console.log(`Tx status: ${result.status}`);
        if (result.isFinalized || result.isError) {
          resolve(result);
        }
      });
  });

  const error = txResult.dispatchError;
  if (txResult.isError) {
    throw new Error(`Transaction failed with error: ${error}`);
  } else if (error != undefined) {
    if (error.isModule) {
      const decoded = api.registry.findMetaError(error.asModule);
      const { docs, name, section } = decoded;
      throw new Error(`${section}.${name}: ${docs.join(" ")}`);
    } else {
      throw new Error(error.toString());
    }
  }

  return {
    status: txResult.status,
    txHash: txResult.txHash.toString(),
  };
}

export async function contractAvailSend(
  //funny error: but specifying type WalletClient then makes me add chain, account params, which ideally should be self processed
  writeClient: WalletClient = walletClient,
  data: ContractAvailSendTypedData,
  readClient: PublicClient = publicClient,
): Promise<TxnReturnType> {
  const pubkey = substrateAddressToPublicKey(data.substrateAddressDestination);
  const send = await writeClient.writeContract({
    address: process.env.BRIDGE_PROXY_ETH as Hex,
    abi: bridgeContractAbi,
    functionName: "sendAVAIL",
    chain: walletClient.chain,
    account: walletClient.account,
    args: [pubkey, data.atomicAmount],
  });

  const receipt = await readClient.waitForTransactionReceipt({
    hash: send,
    confirmations: 5,
  });

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== process.env.BRIDGE_PROXY_ETH!.toLowerCase()
    )
      continue;

    const decoded = decodeEventLog({
      abi: [messageSentEvent],
      data: log.data,
      topics: log.topics,
    });

    if (decoded.eventName === "MessageSent") {
      const { from, to, messageId } = decoded.args as MessageSentEventArgs;
      return {
        status: receipt.status,
        txHash: send,
        event: {
          type: "messageSent",
          from,
          to,
          messageId,
          logIndex: log.logIndex,
          blockNumber: receipt.blockNumber,
        },
      };
    }
  }

  throw new Error("MessageSent event not found in receipt logs");
}

export async function contractReceiveAvail(
  writeClient: WalletClient = walletClient,
  readClient: PublicClient = publicClient,
  merkleProof: ContractReceiveAvailTypedData,
): Promise<TxnReturnType> {
  const recieve = await writeClient.writeContract({
    address: process.env.BRIDGE_PROXY_ETH as Hex,
    abi: bridgeContractAbi,
    chain: walletClient.chain,
    account: walletClient.account,
    functionName: "receiveAVAIL",
    args: [
      [
        "0x02",
        merkleProof.message.from,
        merkleProof.message.to,
        merkleProof.message.originDomain,
        merkleProof.message.destinationDomain,
        encodeAbiParameters(
          [
            {
              name: "assetId",
              type: "bytes32",
            },
            {
              name: "amount",
              type: "uint256",
            },
          ],
          [
            merkleProof.message.message.fungibleToken.asset_id,
            BigInt(merkleProof.message.message.fungibleToken.amount),
          ],
        ),
        merkleProof.message.id,
      ],
      [
        merkleProof.dataRootProof,
        merkleProof.leafProof,
        merkleProof.rangeHash,
        merkleProof.dataRootIndex,
        merkleProof.blobRoot,
        merkleProof.bridgeRoot,
        merkleProof.leaf,
        merkleProof.leafIndex,
      ],
    ],
  });

  const receipt = await readClient.waitForTransactionReceipt({
    hash: recieve,
    confirmations: 5,
  });
  return {
    status: receipt.status,
    txHash: recieve,
  };
}

export async function checkTransactionStatus(
  api: ApiPromise,
  txHash: string,
  type: "subscribeNewHeads" | "subscribeFinalizedHeads" = "subscribeNewHeads",
  timeoutMs: number = 60000,
): Promise<TransactionStatus> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );

  const statusPromise = new Promise<TransactionStatus>(
    async (resolve, reject) => {
      const unsubscribe = await api.rpc.chain[type](async (header) => {
        const blockHash = header.hash;
        const signedBlock = await api.rpc.chain.getBlock(blockHash);
        const allEvents = await api.query.system?.events?.at(blockHash);

        const extrinsicsArray = Array.from(
          signedBlock.block.extrinsics.entries(),
        );

        for (const [index, extrinsic] of extrinsicsArray) {
          if (extrinsic.hash.toHex() === txHash) {
            console.log(`Transaction found in block ${header.number}`);

            const transactionEvent = (allEvents as unknown as Array<any>)?.find(
              ({ phase, event }) =>
                phase.isApplyExtrinsic &&
                phase.asApplyExtrinsic.eq(index) &&
                (api.events?.system?.ExtrinsicFailed?.is(event) ||
                  api.events?.system?.ExtrinsicSuccess?.is(event)),
            );

            unsubscribe();

            if (!transactionEvent) {
              reject(new Error("Transaction event not found"));
              return;
            }

            const { event } = transactionEvent;

            if (api.events?.system?.ExtrinsicFailed?.is(event)) {
              const [dispatchError] = event.data;
              let errorInfo: string;

              if ((dispatchError as any)?.isModule) {
                const decoded = api.registry.findMetaError(
                  (dispatchError as any).asModule,
                );
                errorInfo = `${decoded.section}.${decoded.name}`;
              } else {
                errorInfo = dispatchError?.toString() ?? "Unknown error";
              }

              reject(new Error(`Transaction failed: ${errorInfo}`));
            } else {
              resolve({
                blockHash: blockHash.toHex() as Hex,
                txIndex: index,
                blockNumber: header.number.toNumber(),
              });
            }
            return;
          }
        }
      });
    },
  );

  return Promise.race([statusPromise, timeoutPromise]);
}

//LOW LEVEL UTILS
export function validateEnvVars() {
  const requiredEnvVars = [
    "BRIDGE_API_URL",
    "CONFIG",
    //avail token & bridging contracts based addys
    "BRIDGE_PROXY_ETH",
    "AVAIL_TOKEN_BASE",
    "MANAGER_ADDRESS_BASE",
    "WORMHOLE_TRANSCEIVER_BASE",
    "AVAIL_TOKEN_ETH",
    "MANAGER_ADDRESS_ETH",
    "WORMHOLE_TRANSCEIVER_ETH",
    //seperate out testnet / mainnet tokens for wormhole sdk
    "BASE_NETWORK",
    "ETH_NETWORK",
    //pool addys
    "AVAIL_POOL_ADDRESS",
    "AVAIL_POOL_SEED",
    "EVM_POOL_ADDRESS",
    "EVM_POOL_SEED",
    //rpcs
    "ETH_RPC_URL",
    "AVAIL_RPC",
    //notifier
    "SLACK_BOT_TOKEN",
  ];

  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName],
  );

  if (missingVars.length > 0) {
    console.error("❌ Missing required environment variables:");
    missingVars.forEach((varName) => console.error(`  - ${varName}`));
    process.exit(1);
  }
  console.log("✅ All required environment variables are set");
}

export function getExplorerURLs(
  chain: IChain,
  Hash: string,
  Type: "Block" | "Txn",
): string {
  const isTestnet = process.env.CONFIG === "Testnet";

  switch (chain) {
    case IChain.AVAIL:
      return isTestnet
        ? `https://avail-turing.subscan.io/${Type === "Block" ? "block" : "extrinsic"}/${Hash}`
        : `https://avail.subscan.io/${Type === "Block" ? "block" : "extrinsic"}/${Hash}`;

    case IChain.ETH:
      return isTestnet
        ? `https://sepolia.etherscan.io/${Type === "Block" ? "block" : "tx"}/${Hash}`
        : `https://etherscan.io/${Type === "Block" ? "block" : "tx"}/${Hash}`;

    case IChain.BASE:
      return isTestnet
        ? `https://sepolia.basescan.org/${Type === "Block" ? "block" : "tx"}/${Hash}`
        : `https://basescan.org/${Type === "Block" ? "block" : "tx"}/${Hash}`;

    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

export const stringToByte32 = (str: Hex) => {
  return keccak256(str);
};

function uint8ArrayToByte32String(uint8Array: Uint8Array) {
  if (!(uint8Array instanceof Uint8Array)) {
    throw new Error("Input must be a Uint8Array");
  }
  let hexString = "";
  for (const byte of uint8Array as any) {
    hexString += byte.toString(16).padStart(2, "0");
  }
  if (hexString.length !== 64) {
    throw new Error("Input must be 32 bytes long");
  }
  return "0x" + hexString;
}

export const substrateAddressToPublicKey = (accountId: string) => {
  const keyring = new Keyring({ type: "sr25519" });

  const pair = keyring.addFromAddress(accountId);
  const publicKeyByte8Array = pair.publicKey;
  const publicKeyByte32String = uint8ArrayToByte32String(publicKeyByte8Array);

  return publicKeyByte32String;
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
