import {
  TransactionId,
  Wormhole,
  Chain,
  ChainAddress,
  ChainContext,
  Network,
  Signer,
  chainToPlatform,
  routes,
  toChainId,
} from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/platforms/evm";
import "@wormhole-foundation/sdk-evm-ntt";
import { nttExecutorRoute } from "@wormhole-foundation/sdk-route-ntt";
import { formatUnits, Hex, PublicClient } from "viem";
import { balanceOfAbi } from "./abi";
import { TxnReturnType, WormholeTxnReturnType } from "./types";

const network = () =>
  (process.env.CONFIG ?? "Mainnet") as "Mainnet" | "Testnet" | "Devnet";

const chainName = (name: string, mainnet: string, testnet: string) =>
  process.env[name] ?? (network() === "Mainnet" ? mainnet : testnet);

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : "");
  if (!value)
    throw new Error(`Missing ${name}${fallback ? ` or ${fallback}` : ""}`);
  return value;
};

export const UPDATED_NTT_TOKENS = {
  [chainName("BASE_NETWORK", "Base", "BaseSepolia")]: {
    token: env("AVAIL_TOKEN_BASE", "NEXT_PUBLIC_AVAIL_TOKEN_BASE"),
    manager: env("MANAGER_ADDRESS_BASE", "NEXT_PUBLIC_MANAGER_ADDRESS_BASE"),
    transceiver: {
      wormhole: env(
        "WORMHOLE_TRANSCEIVER_BASE",
        "NEXT_PUBLIC_WORMHOLE_TRANSCEIVER_BASE",
      ),
    },
  },
  [chainName("ETH_NETWORK", "Ethereum", "Sepolia")]: {
    token: env("AVAIL_TOKEN_ETH", "NEXT_PUBLIC_AVAIL_TOKEN_ETH"),
    manager: env("MANAGER_ADDRESS_ETH", "NEXT_PUBLIC_MANAGER_ADDRESS_ETH"),
    transceiver: {
      wormhole: env(
        "WORMHOLE_TRANSCEIVER_ETH",
        "NEXT_PUBLIC_WORMHOLE_TRANSCEIVER_ETH",
      ),
    },
  },
};

const NTT_ROUTE_CONFIG = {
  tokens: {
    AVAIL: Object.entries(UPDATED_NTT_TOKENS).map(([chain, contracts]) => ({
      chain,
      token: contracts.token,
      manager: contracts.manager,
      transceiver: [
        { type: "wormhole", address: contracts.transceiver.wormhole },
      ],
    })),
  },
};

export interface SignerStuff<N extends Network, C extends Chain> {
  chain: ChainContext<N, C>;
  signer: Signer<N, C>;
  address: ChainAddress<C>;
}

export async function getTxnStatus(
  sourceHash: Hex,
): Promise<WormholeTxnReturnType> {
  const MAX_DURATION = 30 * 60 * 1000; // 30 minutes
  const POLL_INTERVAL = 5000; // 5 seconds
  const startTime = Date.now();

  let counter = 0;
  console.log("starting to poll transaction status for txn hash", sourceHash);
  while (Date.now() - startTime < MAX_DURATION) {
    try {
      const response = await fetch(
        `https://api.${process.env.CONFIG === "Mainnet" ? "" : "testnet."}wormholescan.io/api/v1/operations?txHash=${sourceHash}`,
      );

      if (!response.ok) {
        throw new Error(
          `API returned ${response.status} for txn ${sourceHash}`,
        );
      }

      const txn = (await response.json()) as WormholeTxnReturnType;
      if (txn.operations?.[0]?.targetChain?.status === "completed") {
        return txn;
      }
      console.log(
        "txn not completed yet, repolling, latest status fetched",
        counter,
      );

      counter++;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    } catch (error: any) {
      console.error(`Error polling txn ${sourceHash}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  throw new Error(`Transaction ${sourceHash} timed out after 30 minutes`);
}

async function getExecutorTxnStatus(
  sourceHash: Hex,
  sourceChain: Chain,
): Promise<TxnReturnType> {
  const MAX_DURATION = 30 * 60 * 1000;
  const POLL_INTERVAL = 5000;
  const startTime = Date.now();
  const url = `https://executor${network() === "Mainnet" ? "" : "-testnet"}.labsapis.com/v0/status/tx`;

  while (Date.now() - startTime < MAX_DURATION) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: sourceHash,
        chainId: toChainId(sourceChain),
      }),
    });
    const data = await response.json();
    const [status] = Array.isArray(data) ? data : [];

    if (status?.status === "submitted") {
      const txs = status.txs ?? [];
      return {
        txHash: txs[txs.length - 1]?.txHash ?? sourceHash,
        status: status.status,
      };
    }

    if (
      ["failed", "unsupported", "underpaid", "aborted"].includes(
        status?.status,
      )
    ) {
      throw new Error(status.failureMessage ?? `Executor relay ${status.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error(`Executor relay ${sourceHash} timed out after 30 minutes`);
}

export async function getSigner<N extends Network, C extends Chain>(
  chain: ChainContext<N, C>,
): Promise<SignerStuff<N, C>> {
  let signer: Signer;
  const platform = chainToPlatform(chain.chain);
  switch (platform) {
    case "Evm":
      signer = await evm.getSigner(
        await chain.getRpc(),
        env("EVM_POOL_SEED", "WALLET_SIGNER_KEY_ETH"),
      );
      break;
    default:
      throw new Error("Unrecognized platform: " + platform);
  }

  return {
    chain,
    signer: signer as Signer<N, C>,
    address: Wormhole.chainAddress(chain.chain, signer.address()),
  };
}

//info: if this fails to work in prod, it is most prolly a dep mismanagement, make sure to use overrides in package.json
export async function initiateWormholeBridge(
  publicClient: PublicClient,
  srcChain: string,
  dstChain: string,
  //wormhole sdk expects bigint, so we send it as string here to maintain uniformity
  amount?: bigint,
  track: boolean = true,
): Promise<TxnReturnType> {
  const wh = new Wormhole(
    network(),
    [evm.Platform],
    {
      chains: {
        [chainName("BASE_NETWORK", "Base", "BaseSepolia")]: {
          rpc:
            process.env.BASE_RPC_URL ??
            (network() === "Mainnet"
              ? "https://mainnet.base.org"
              : "https://sepolia.base.org"),
        },
        [chainName("ETH_NETWORK", "Ethereum", "Sepolia")]: {
          rpc:
            process.env.ETH_RPC_URL ??
            (network() === "Mainnet"
              ? "https://ethereum-rpc.publicnode.com"
              : "https://ethereum-sepolia-rpc.publicnode.com"),
        },
      },
    },
  );

  const src = wh.getChain(
    srcChain as "BaseSepolia" | "Sepolia" | "Base" | "Ethereum",
  );
  const dst = wh.getChain(
    dstChain as "BaseSepolia" | "Sepolia" | "Base" | "Ethereum",
  );

  const srcSigner = await getSigner(src);
  const dstSigner = await getSigner(dst);

  const srcNtt = await src.getProtocol("Ntt", {
    ntt: UPDATED_NTT_TOKENS[src.chain],
  });
  const dstNtt = await dst.getProtocol("Ntt", {
    ntt: UPDATED_NTT_TOKENS[dst.chain],
  });

  const balance = await publicClient.readContract({
    address: UPDATED_NTT_TOKENS[src.chain]!.token as Hex,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [srcSigner.address.address.toString() as Hex],
  });

  console.log(
    `💰 Current AVAIL balance on source ${srcChain}: ${formatUnits(balance, await srcNtt.getTokenDecimals())}`,
  );

  if (balance === 0n) throw new Error("No AVAIL tokens to bridge");
  const amountToBridge = amount ?? balance;
  if (amountToBridge > balance) throw new Error("Insufficient AVAIL balance");

  let txnIds!: TransactionId[];

  for (let i = 0; i < 3; i++) {
    try {
      console.log(`🔄 Initiating bridge to ${dstChain}`);
      const srcDecimals = await srcNtt.getTokenDecimals();
      const dstDecimals = await dstNtt.getTokenDecimals();

      const ExecutorRoute = nttExecutorRoute({ ntt: NTT_ROUTE_CONFIG as any });
      const route = new ExecutorRoute(wh as any);
      const request = await routes.RouteTransferRequest.create(
        wh as any,
        {
          source: Wormhole.tokenId(
            src.chain,
            UPDATED_NTT_TOKENS[src.chain]!.token,
          ),
          destination: Wormhole.tokenId(
            dst.chain,
            UPDATED_NTT_TOKENS[dst.chain]!.token,
          ),
          sourceDecimals: srcDecimals,
          destinationDecimals: dstDecimals,
          sender: srcSigner.address,
          recipient: dstSigner.address,
        },
        src as any,
        dst as any,
      );

      const validated = await route.validate(request as any, {
        amount: formatUnits(amountToBridge, srcDecimals),
        options: { nativeGas: 0 },
      } as any);

      if (!validated.valid) throw validated.error;

      const quote = await route.quote(request as any, validated.params as any);

      if (!quote.success) throw quote.error;

      const receipt = (await route.initiate(
        request as any,
        srcSigner.signer,
        quote as any,
        dstSigner.address,
      )) as any;

      txnIds = receipt.originTxs;
      break;
    } catch (e: any) {
      console.log("TRY NO", i + 1, "failed due to --", e.message);
      if (i === 2)
        throw new Error(
          `retries exhausted while sending wormhole txn ${e.message}`,
        );
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }

  console.log("✅ Bridge transaction initiated");
  if (!txnIds?.length) {
    throw new Error("No Txn ids available something went wrong here");
  }

  const sourceTxHash = txnIds[txnIds.length - 1]?.txid ?? txnIds[0].txid;
  console.log(
    `🔗 View on wormholescan: https://wormholescan.io/#/tx/${sourceTxHash}?network=${network()}`,
  );

  if (!track) {
    return {
      txHash: sourceTxHash,
      status: "initated",
    };
  }

  const result = await getExecutorTxnStatus(sourceTxHash as Hex, src.chain);

  return {
    wormholeInitiateHash: sourceTxHash,
    txHash: result.txHash,
    status: result.status,
  };
}
