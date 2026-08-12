import {
  checkTransactionStatus,
  contractReceiveAvail,
  getExplorerURLs,
  getMerkleProof,
  sendMessage,
} from "../utils/helpers";
import {
  BridgingResult,
  HeadResponse,
  IChain,
  SendMessageTypedData,
  TxnReturnType,
} from "../utils/types";
import jsonbigint from "json-bigint";
import { ApiPromise, KeyringPair, SubmittableResult } from "avail-js-sdk";
import { availAccount, publicClient, walletClient } from "../utils/client";
import { initiateWormholeBridge } from "../utils/wormhole";
import { Hex } from "viem";

const JSONBigInt = jsonbigint({ useNativeBigInt: true });
const BRIDGE_API_URL = process.env.BRIDGE_API_URL!;

export const ASSET_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
1. start with initiate vector.sendMessage()
2. track txn receipt using the new api
3. every 10 minutes run while loop for proof fetching & try to claim
  a. if claimable, claim and then track till finalisation
4. when money reaches ethereum, initate a approval + transfer txn through the wormhole sdk to the base
5. fetch VAA, until the txn is reaches base
6. spill to a db
*/
export async function AVAIL_TO_BASE(
  api: ApiPromise,
  amount: string,
): Promise<BridgingResult> {
  const data: SendMessageTypedData = {
    destinationDomain: 2,
    message: {
      FungibleToken: {
        amount: amount,
        assetId: ASSET_ID,
      },
    },
    to: process.env.EVM_POOL_ADDRESS!.padEnd(66, "0"),
  };

  let burnOnAvail: TxnReturnType<SubmittableResult["status"]> | undefined;

  for (let i = 0; i < 3; i++) {
    try {
      burnOnAvail = await sendMessage(availAccount, api, data);
      if (!burnOnAvail.status.isFinalized) throw new Error("Not finalized");
      console.log(
        "✅ Transaction Hash",
        getExplorerURLs(IChain.AVAIL, burnOnAvail.txHash, "Txn"),
      );
      break;
    } catch (error) {
      if (i === 2) throw error;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }

  if (!burnOnAvail) {
    throw new Error("Failed to send message on Avail");
  }

  const getBlockData = await checkTransactionStatus(
    api,
    burnOnAvail.txHash,
    "subscribeFinalizedHeads",
    6000000,
  );

  console.log(
    "✅ Transaction included in block:",
    getExplorerURLs(IChain.AVAIL, getBlockData.blockHash, "Block"),
  );
  console.log("✅ Transaction index:", getBlockData.txIndex);
  console.log("checking commitments on ethereum for claim");

  let hasReceivedAvail = false;
  let lastTransactionHash: Hex | undefined;

  while (true) {
    const headRsp = await fetch(BRIDGE_API_URL + "/v1/avl/head");
    if (!headRsp.ok) throw new Error("Failed to fetch chain head");
    const head = (await headRsp.json()) as HeadResponse;
    const lastCommittedBlock = head.data.end;

    if (!hasReceivedAvail && lastCommittedBlock >= getBlockData.blockNumber) {
      for (let i = 0; i < 30; i++) {
        try {
          const proof = await getMerkleProof(
            getBlockData.blockHash,
            getBlockData.txIndex,
          );
          console.log("✅ Proof fetched successfully");

          const result = await contractReceiveAvail(
            walletClient,
            publicClient,
            proof,
          );
          if (result.status !== "success")
            throw new Error("Transaction failed");
          console.log(`✅ AVAIL received`);
          console.log(
            `🔗 View on Etherscan: ${getExplorerURLs(IChain.ETH, result.txHash, "Txn")}`,
          );
          lastTransactionHash = result.txHash as Hex;
          hasReceivedAvail = true;
          break;
        } catch (error) {
          if (i === 29) throw new Error("Failed to claim after 30 attempts");
          console.log(`❌ Claim attempt ${i + 1}/30 failed, retrying...`);
          await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
        }
      }
    }

    if (hasReceivedAvail) {
      const wormholeTxnIds = await initiateWormholeBridge(
        publicClient,
        process.env.ETH_NETWORK!,
        process.env.BASE_NETWORK!,
      );
      console.log(
        "✅ bridged to wormhole successfully, flow done",
        wormholeTxnIds,
      );

      return {
        initiateExplorerLink: getExplorerURLs(
          IChain.AVAIL,
          burnOnAvail.txHash,
          "Txn",
        ),
        destinationExplorerLink: getExplorerURLs(
          IChain.BASE,
          wormholeTxnIds.txHash,
          "Txn",
        ),
      };
    }

    console.log(
      `⏳ Waiting for bridge commitment on ethereum (${lastCommittedBlock}/${getBlockData.blockNumber})...`,
    );
    await new Promise((r) => setTimeout(r, 60 * 1000));
  }
}
