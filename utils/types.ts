import { Hex } from "viem";

export type LogType = "error" | "warn" | "info" | "success";

export type SlackOk = { ok: true; ts: string };
export type SlackErr = {
  ok: false;
  error: string;
  needed?: string;
  provided?: string;
};

export const TYPE_META: Record<
  LogType,
  {
    prefix: string;
    emoji: string;
    buttonStyle: "primary" | "danger";
    color: string;
  }
> = {
  error: {
    prefix: "ERROR",
    emoji: " ❌ ",
    buttonStyle: "danger",
    color: "#e01e5a",
  },
  warn: {
    prefix: "WARNING",
    emoji: " ⚠️ ",
    buttonStyle: "danger",
    color: "#daa038",
  },
  info: {
    prefix: "INFO",
    emoji: " 🎛️ ",
    buttonStyle: "primary",
    color: "#1264a3",
  },
  success: {
    prefix: "SUCCESS",
    emoji: " ✅ ",
    buttonStyle: "primary",
    color: "#2eb886",
  },
};

export interface BridgingResult {
  initiateExplorerLink: string;
  destinationExplorerLink: string;
}

export interface ProofData {
  dataRootProof: Array<string>;
  leafProof: string;
  rangeHash: string;
  dataRootIndex: number;
  blobRoot: string;
  bridgeRoot: string;
  leaf: string;
  leafIndex: number;
  message: AvailMessage;
}

export interface TransactionStatus {
  blockHash: Hex;
  txIndex: number;
  blockNumber: number;
}

export interface AccountAndStorageProof {
  accountProof: Hex[];
  storageProof: Hex[];
}

export interface ChainState {
  ethHead: {
    slot: 0;
    timestamp: 0;
    timestampDiff: 0;
    blockNumber: 0;
    blockHash: "";
  };
  avlHead: {
    end: 0;
    start: 0;
    endTimestamp: 0;
  };
}

export interface AvailMessage {
  destinationDomain: number;
  from: string;
  id: number;
  message: {
    fungibleToken: {
      amount: bigint;
      asset_id: Hex;
    };
  };
  originDomain: number;
  to: string;
}

export interface HeadResponse {
  slot: number;
  blockHash: Hex;
  blockNumber: number;
  data: {
    end: number;
  };
}

export interface SendMessageTypedData {
  destinationDomain: number;
  message: {
    FungibleToken: {
      //verify the extrinsic works with string
      amount: bigint | string;
      assetId: Hex;
    };
  };
  to: string;
}

export interface IResponse {
  success: boolean;
  error?: string;
}

export enum IChain {
  AVAIL = "AVAIL",
  ETH = "ETH",
  BASE = "BASE",
}

export type WithBalanceData<T, U = any> = T & {
  data: {
    free: U;
    frozen: U;
  };
};

export interface TxnReturnType<T = string> {
  status: T;
  txHash: string;
  wormholeInitiateHash?: string;
  event?: {
    type: "messageSent";
    logIndex?: number;
    from: Hex;
    to: Hex;
    messageId: bigint;
    blockNumber: bigint;
  };
}

export type MessageSentEventArgs = {
  from: Hex;
  to: Hex;
  messageId: bigint;
};

export interface ExecuteMessageTypedData {
  slot: number;
  addrMessage: {
    message: {
      ArbitraryMessage?: Hex;
      FungibleToken?: {
        assetId: Hex;
        amount: string;
      };
    };
    from: `${string}`;
    to: `${string}`;
    originDomain: number;
    destinationDomain: number;
    id: number;
  };
  accountProof: Hex[];
  storageProof: Hex[];
}

export interface ContractAvailSendTypedData {
  substrateAddressDestination: string;
  atomicAmount: string;
}

interface EthMessage {
  destinationDomain: number;
  from: string;
  id: number;
  message: {
    fungibleToken: {
      amount: bigint;
      asset_id: `0x${string}`;
    };
  };
  originDomain: number;
  to: string;
  messageType: string;
}

export interface ContractReceiveAvailTypedData {
  blobRoot: string;
  blockHash: string;
  bridgeRoot: string;
  dataRoot: string;
  dataRootCommitment: string;
  dataRootIndex: number;
  dataRootProof: Hex[];
  leaf: string;
  leafIndex: number;
  leafProof: Hex[];
  message: EthMessage;
  rangeHash: string;
}

//wormhole types for handling txn status
export interface WormholeTxnReturnType {
  operations: Operation[];
}

export interface Root {
  operations: Operation[];
}

export interface Operation {
  id: string;
  emitterChain: number;
  emitterAddress: EmitterAddress;
  sequence: string;
  vaa: Vaa;
  content: Content;
  sourceChain: SourceChain;
  targetChain?: TargetChain;
  data?: Data;
}

export interface EmitterAddress {
  hex: string;
  native: string;
}

export interface Vaa {
  raw: string;
  guardianSetIndex: number;
  isDuplicated: boolean;
}

export interface Content {
  payload: Payload;
  standarizedProperties: StandarizedProperties;
  executorRequest: any;
}

export interface Payload {
  encodedExecutionInfo: EncodedExecutionInfo;
  extraReceiverValue: string;
  messageKeys: any[];
  parsedPayload: ParsedPayload;
  payload: string;
  payloadType: number;
  refundAddress: string;
  refundChainId: number;
  refundDeliveryProvider: string;
  requestedReceiverValue: string;
  senderAddress: string;
  sourceDeliveryProvider: string;
  targetAddress: string;
  targetChainId: number;
}

export interface EncodedExecutionInfo {
  gasLimit: string;
  targetChainRefundPerGasUnused: string;
}

export interface ParsedPayload {
  nttManagerMessage: NttManagerMessage;
  nttMessage: NttMessage;
  transceiverMessage: TransceiverMessage;
}

export interface NttManagerMessage {
  id: string;
  sender: string;
}

export interface NttMessage {
  additionalPayload: string;
  sourceToken: string;
  to: string;
  toChain: number;
  trimmedAmount: TrimmedAmount;
}

export interface TrimmedAmount {
  amount: string;
  decimals: number;
}

export interface TransceiverMessage {
  prefix: string;
  recipientNttManager: string;
  sourceNttManager: string;
  transceiverPayload: string;
}

export interface StandarizedProperties {
  appIds: string[];
  fromChain: number;
  fromAddress: string;
  toChain: number;
  toAddress: string;
  tokenChain: number;
  tokenAddress: string;
  amount: string;
  feeAddress: string;
  feeChain: number;
  fee: string;
  normalizedDecimals: number;
}

export interface SourceChain {
  chainId: number;
  timestamp: string;
  transaction: Transaction;
  from: string;
  status: string;
  fee: string;
  gasTokenNotional: string;
  feeUSD: string;
}

export interface Transaction {
  txHash: string;
}

export interface TargetChain {
  chainId: number;
  timestamp: string;
  transaction: Transaction2;
  status: string;
  from: string;
  to: string;
  fee: string;
  gasTokenNotional: string;
  feeUSD: string;
  balanceChanges: BalanceChange[];
}

export interface Transaction2 {
  txHash: string;
}

export interface BalanceChange {
  amount: string;
  recipient: string;
  tokenAddress: string;
}

export interface Data {
  symbol: string;
  tokenAmount: string;
  usdAmount: string;
}
