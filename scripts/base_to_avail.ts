import { Hex, PublicClient } from "viem";
import {
  availAccount,
  baseClient,
  publicClient,
  walletClient,
} from "../utils/client";
import { initiateWormholeBridge } from "../utils/wormhole";
import {
  contractAvailSend,
  executeMessage,
  getAccountStorageProofs,
  getExplorerURLs,
} from "../utils/helpers";
import { availTokenAbi } from "../utils/abi";
import { BigNumber } from "bignumber.js";
import {
  BridgingResult,
  ContractAvailSendTypedData,
  ExecuteMessageTypedData,
  HeadResponse,
  IChain,
  TxnReturnType,
} from "../utils/types";
import { decodeAddress } from "@polkadot/keyring";
import { u8aToHex } from "@polkadot/util";
import { ApiPromise, KeyringPair, SubmittableResult } from "avail-js-sdk";
import { ASSET_ID } from "./avail_to_base";

const BRIDGE_API_URL = process.env.BRIDGE_API_URL!;

/**
 * 1. start with wormhole (move funds from base to eth)
 * 2. check funds reaching ethereum, 18-20 mins wait, then you actually start on ethereum
 * 3. on ethereum, start by sendavail, check finalisation and such
 * 4. wait 2 hours
 * 5. fetch avl/proof (Account / Storage proof) - you need amount from above
 * 6. vector.execute
 *
 */
export async function BASE_TO_AVAIL(
  api: ApiPromise,
  amount: string,
): Promise<BridgingResult> {
  const initiateHash = await initiateWormholeBridge(
    baseClient as PublicClient,
    process.env.BASE_NETWORK!,
    process.env.ETH_NETWORK!,
    BigInt(amount),
  );

  console.log("initiate hash on wormhole", initiateHash);
  const evmPoolBalance = await publicClient.readContract({
    address: process.env.AVAIL_TOKEN_ETH as Hex,
    abi: availTokenAbi,
    functionName: "balanceOf",
    args: [process.env.EVM_POOL_ADDRESS as Hex],
  });

  if (new BigNumber(evmPoolBalance).isLessThan(new BigNumber(amount))) {
    throw new Error(
      "evm pool balance has no erc20 avail to be bridged, did the wormhole bridge work? ",
    );
  }

  console.log("initiating bridge from ethereum");
  const sendToAvailParams: ContractAvailSendTypedData = {
    substrateAddressDestination: process.env.AVAIL_POOL_ADDRESS!,
    atomicAmount: amount,
  };

  let availSendReturn: TxnReturnType | undefined;
  for (let i = 0; i < 3; i++) {
    try {
      availSendReturn = await contractAvailSend(
        walletClient,
        sendToAvailParams,
      );
      break;
    } catch (e: any) {
      if (i === 2) {
        throw new Error(
          `max no of retries reached while calling contract sendAvail ${e.message}`,
        );
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); // ✅ Added exponential backoff
    }
  }

  if (!availSendReturn) {
    throw new Error("Failed to send to Avail after retries");
  }

  console.log("txn on ethereum", availSendReturn);

  const MAX_POLLING_TIME = 3 * 60 * 60 * 1000;
  const startTime = Date.now();

  while (true) {
    console.log("starting to poll for proofs");
    if (Date.now() - startTime > MAX_POLLING_TIME) {
      throw new Error(
        "Polling timeout: proofs not available even after 3 hours",
      );
    }

    const txSendBlockNumber: number = Number(
      availSendReturn.event?.blockNumber,
    );

    const getHeadRsp = await fetch(BRIDGE_API_URL + "/v1/eth/head");
    if (!getHeadRsp.ok) throw new Error("Failed to fetch chain head");
    const headRsp = (await getHeadRsp.json()) as HeadResponse;
    const slot: number = headRsp.slot;

    if (txSendBlockNumber < headRsp.blockNumber) {
      const proofs = await getAccountStorageProofs(
        headRsp.blockHash,
        Number(availSendReturn.event?.messageId),
      );

      const availClaimData: ExecuteMessageTypedData = {
        accountProof: proofs.accountProof,
        storageProof: proofs.storageProof,
        slot,
        addrMessage: {
          message: {
            FungibleToken: {
              assetId: ASSET_ID,
              amount,
            },
          },
          from: process.env.EVM_POOL_ADDRESS!.padEnd(66, "0"),
          to: u8aToHex(decodeAddress(process.env.AVAIL_POOL_ADDRESS)),
          originDomain: 2,
          destinationDomain: 1,
          id: Number(availSendReturn.event?.messageId),
        },
      };

      let mintOnAvail!: TxnReturnType<SubmittableResult["status"]>;

      for (let i = 0; i < 3; i++) {
        try {
          mintOnAvail = await executeMessage(availAccount, api, availClaimData);
          if (!mintOnAvail.status.isFinalized) throw new Error("Not finalized");
          console.log("✅ Transaction included in block:", mintOnAvail.txHash);
          break;
        } catch (error) {
          if (i === 2) throw error;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }

      console.log("✅ Claim successful, exiting polling loop.");
      return {
        initiateExplorerLink: getExplorerURLs(
          IChain.BASE,
          //we know for sure we'll have it until here
          initiateHash.wormholeInitiateHash!,
          "Txn",
        ),
        destinationExplorerLink: getExplorerURLs(
          IChain.AVAIL,
          mintOnAvail.txHash,
          "Txn",
        ),
      };
    }

    await new Promise((f) => setTimeout(f, 60 * 1000));
  }
}
