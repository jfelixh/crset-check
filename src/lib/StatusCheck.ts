import { isAddress } from "ethers";
import { APIConfig, StatusCheckOptions } from "../types/config";
import { VerifiableCredentialWithStatus as VerifiableCredential } from "../types/verifiableCredential";
import { extractCredentialStatus } from "../utils/extractCredentialStatus";
import { getBlobDataFromSenderAddress } from "../utils/reader";
import { fromDataHexString, isInBFC } from "crset-cascade";

/**
 * Checks if a Verifiable Credential (VC) has been revoked via bloom filter cascade.
 *
 * @param vc - The Verifiable Credential to check.
 * @param apiConfig - The API configuration for making network requests.
 * @param options - Optional parameters for status checking.
 * @param options.emitter - An optional event emitter for progress updates.
 * @param options.clientId - An optional client ID for tracking progress.
 * @returns A promise that resolves to a boolean indicating whether the VC is revoked.
 *
 * @throws Will throw an error if the Ethereum address extracted from the credential status is invalid.
 *
 * @example
 * ```typescript
 * const vc: VerifiableCredential = { ... };
 * const apiConfig = {
 *   infuraApiKey: 'your-infura-api-key',
 *   moralisApiKey: 'your-moralis-api-key',
 *   blobScanUrl: 'https://api.sepolia.blobscan.com/blob', // or 'https://api.blobscan.com/blob'
 * };
 * const options = {
 *   emitter: new EventEmitter(),
 *   clientId: 'your-client-id',
 * };
 * const isRevoked = await isRevoked(vc, apiConfig, options);
 * console.log(isRevoked); // true or false
 * ```
 */
export async function isRevoked(
  vc: VerifiableCredential,
  apiConfig: APIConfig,
  options?: StatusCheckOptions,
): Promise<boolean> {
  const { emitter, clientId } = options || { emitter: null, clientId: null };
  emitter?.emit("progress", {
    clientId: clientId,
    step: "extractPublisherAddress",
    status: "started",
  });
  // Check if VC is JSON-LD or JWT, handle accordingly
  const credentialStatus = extractCredentialStatus(vc);
  const credentialId = credentialStatus.id;
  const credentialIdParts = credentialId.split(":");
  const revocationId = credentialIdParts[credentialIdParts.length - 1];

  // Get account address from CAIP-10 account ID in credential status
  const accountAddress = credentialId
    .split(":")
    .find((part) => isAddress(part));
  emitter?.emit("progress", {
    clientId: clientId,
    step: "extractPublisherAddress",
    status: "completed",
    additionalMetrics: { address: accountAddress },
  });
  if (!isAddress(accountAddress)) {
    throw new Error("Invalid Ethereum address: " + accountAddress);
  }

  // Get blob data from sender address
  const blobData = await getBlobDataFromSenderAddress(
    accountAddress,
    apiConfig,
    options,
  );

  // Reconstruct bloom filter cascade from blob data
  emitter?.emit("progress", {
    clientId: clientId,
    step: "reconstructBFC",
    status: "started",
  });
  // eslint-disable-next-line prefer-const
  let [filter, salt] = fromDataHexString(blobData);
  // remove elements of length 0 from filter
  filter = filter.filter((element) => element.buckets.length > 0);
  emitter?.emit("progress", {
    clientId: clientId,
    step: "reconstructBFC",
    status: "completed",
    additionalMetrics: { levelCount: filter.length },
  });
  emitter?.emit("progress", {
    clientId: clientId,
    step: "checkRevocation",
    status: "started",
  });
  const isRevoked = !isInBFC(revocationId, filter, salt);
  emitter?.emit("progress", {
    clientId: clientId,
    step: "checkRevocation",
    status: "completed",
    additionalMetrics: { isRevoked: isRevoked },
  });

  return isRevoked;
}
