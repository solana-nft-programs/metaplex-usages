import { withCreateMint } from "@cardinal/common";
import {
  createCreateMasterEditionV3Instruction,
  UseMethod,
  createCreateMetadataAccountV2Instruction,
  createApproveUseAuthorityInstruction,
  createUtilizeInstruction,
} from "@metaplex-foundation/mpl-token-metadata";
import { Metadata, MasterEdition, MetadataProgram } from "mpl-token-metadata-1";
import { BN, utils } from "@project-serum/anchor";
import { SignerWallet } from "@saberhq/solana-contrib";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  Connection,
  SystemProgram,
  sendAndConfirmRawTransaction,
  PublicKey,
} from "@solana/web3.js";
import * as splToken from "@solana/spl-token";

const networkURLs: { [key: string]: string } = {
  ["mainnet-beta"]: "https://api.mainnet-beta.solana.com/",
  mainnet: "https://api.mainnet-beta.solana.com/",
  devnet: "https://api.devnet.solana.com/",
  testnet: "https://api.testnet.solana.com/",
  localnet: "http://localhost:8899/",
};

export const connectionFor = (
  cluster: string | null,
  defaultCluster: string = "mainnet"
) => {
  return new Connection(
    process.env.RPC_URL || networkURLs[cluster || defaultCluster],
    "recent"
  );
};

const METADATA = {
  name: "name",
  symbol: "symbol",
  uri: "https://5lnur4iv4v5bmbk6zfyjecgkk4jk53xujvoestodi3vsr7lqhm.arweave.net/6ttI8RXlehYFXslwkgjKVxKu7vRNXElNw0brKP1w-O4/",
};

export async function main(cluster = "devnet"): Promise<string> {
  const connection = connectionFor(cluster);
  const tokenCreator = Keypair.generate();
  const useAuthorityKeypair = Keypair.generate();
  console.log(
    `Testing with public key... creator (${tokenCreator.publicKey.toString()}) useAuthority (${useAuthorityKeypair.publicKey.toString()})`
  );

  //////////////////////// AIRDROP ////////////////////////
  await connection.confirmTransaction(
    await connection.requestAirdrop(tokenCreator.publicKey, LAMPORTS_PER_SOL)
  );
  const transferTx = new Transaction();
  transferTx.add(
    SystemProgram.transfer({
      fromPubkey: tokenCreator.publicKey,
      toPubkey: useAuthorityKeypair.publicKey,
      lamports: LAMPORTS_PER_SOL / 2,
    })
  );
  transferTx.feePayer = tokenCreator.publicKey;
  transferTx.recentBlockhash = (
    await connection.getRecentBlockhash("max")
  ).blockhash;
  transferTx.sign(tokenCreator);
  const transferTxid = await sendAndConfirmRawTransaction(
    connection,
    transferTx.serialize()
  );
  console.log(
    `1. Succesfully airdropped and transferred to: ${tokenCreator.publicKey.toString()} txid (${transferTxid})\n `
  );

  //////////////////////// CREATE MASTER EDITION 1 USAGE TYPE BURN ////////////////////////
  const tokenKeypair = Keypair.generate();
  const createTokenTx = new Transaction();
  const [tokenAccountId] = await withCreateMint(
    createTokenTx,
    connection,
    new SignerWallet(tokenCreator),
    tokenCreator.publicKey,
    tokenKeypair.publicKey
  );
  const metadataId = await Metadata.getPDA(tokenKeypair.publicKey);
  createTokenTx.add(
    createCreateMetadataAccountV2Instruction(
      {
        metadata: metadataId,
        mint: tokenKeypair.publicKey,
        mintAuthority: tokenCreator.publicKey,
        updateAuthority: tokenCreator.publicKey,
        payer: tokenCreator.publicKey,
      },
      {
        createMetadataAccountArgsV2: {
          data: {
            name: METADATA.name,
            symbol: METADATA.symbol,
            uri: METADATA.uri,
            sellerFeeBasisPoints: 10,
            creators: null,
            collection: null,
            uses: {
              useMethod: UseMethod.Burn,
              total: 2,
              remaining: 2,
            },
          },
          isMutable: true,
        },
      }
    )
  );

  const masterEditionId = await MasterEdition.getPDA(tokenKeypair.publicKey);
  createTokenTx.add(
    createCreateMasterEditionV3Instruction(
      {
        edition: masterEditionId,
        metadata: metadataId,
        updateAuthority: tokenCreator.publicKey,
        mint: tokenKeypair.publicKey,
        mintAuthority: tokenCreator.publicKey,
        payer: tokenCreator.publicKey,
      },
      {
        createMasterEditionArgs: {
          maxSupply: new BN(1),
        },
      }
    )
  );
  createTokenTx.feePayer = tokenCreator.publicKey;
  createTokenTx.recentBlockhash = (
    await connection.getRecentBlockhash("max")
  ).blockhash;
  createTokenTx.sign(tokenCreator);
  createTokenTx.partialSign(tokenKeypair);
  const createTokenTxid = await sendAndConfirmRawTransaction(
    connection,
    createTokenTx.serialize()
  );
  console.log(
    `2. Master edition (${masterEditionId.toString()}) created with metadata (${metadataId.toString()}) txid (${createTokenTxid})\n`
  );

  //////////////////////// APPROVE USE AUTHORITY ////////////////////////
  const approveUseTx = new Transaction();
  console.log(
    "Approving use authority... ",
    useAuthorityKeypair.publicKey.toString()
  );
  const [useAuthorityRecordId] = await PublicKey.findProgramAddress(
    [
      utils.bytes.utf8.encode("metadata"),
      MetadataProgram.PUBKEY.toBuffer(),
      tokenKeypair.publicKey.toBuffer(),
      utils.bytes.utf8.encode("user"),
      useAuthorityKeypair.publicKey.toBuffer(),
    ],
    MetadataProgram.PUBKEY
  );
  const [burnerId] = await PublicKey.findProgramAddress(
    [
      utils.bytes.utf8.encode("metadata"),
      MetadataProgram.PUBKEY.toBuffer(),
      utils.bytes.utf8.encode("burn"),
    ],
    MetadataProgram.PUBKEY
  );
  approveUseTx.add(
    createApproveUseAuthorityInstruction(
      {
        useAuthorityRecord: useAuthorityRecordId,
        user: useAuthorityKeypair.publicKey,
        owner: tokenCreator.publicKey,
        payer: tokenCreator.publicKey,
        ownerTokenAccount: tokenAccountId,
        metadata: metadataId,
        mint: tokenKeypair.publicKey,
        burner: burnerId,
      },
      { approveUseAuthorityArgs: { numberOfUses: 2 } }
    )
  );
  approveUseTx.feePayer = tokenCreator.publicKey;
  approveUseTx.recentBlockhash = (
    await connection.getRecentBlockhash("max")
  ).blockhash;
  approveUseTx.sign(tokenCreator);
  const approveUseTxid = await sendAndConfirmRawTransaction(
    connection,
    approveUseTx.serialize()
  );
  console.log(
    `3. Usage approved for user (${useAuthorityKeypair.publicKey.toString()}) txid (${approveUseTxid})\n`
  );
  const splTokenMint = new splToken.Token(
    connection,
    tokenKeypair.publicKey,
    splToken.TOKEN_PROGRAM_ID,
    tokenCreator
  );
  const tokenAccountInfo1 = await splTokenMint.getAccountInfo(tokenAccountId);
  console.log("Delegate before: ", tokenAccountInfo1.delegate?.toString());

  //////////////////////// USE AUTHORITY ATTEMPT TO USE ////////////////////////
  console.log("Use authority attempt to use... ");
  const useFirstTx = new Transaction();
  useFirstTx.add(
    createUtilizeInstruction(
      {
        metadata: metadataId,
        tokenAccount: tokenAccountId,
        mint: tokenKeypair.publicKey,
        useAuthority: useAuthorityKeypair.publicKey,
        owner: tokenCreator.publicKey,
        useAuthorityRecord: useAuthorityRecordId,
        burner: burnerId,
      },
      {
        utilizeArgs: { numberOfUses: 1 },
      }
    )
  );
  useFirstTx.feePayer = useAuthorityKeypair.publicKey;
  useFirstTx.recentBlockhash = (
    await connection.getRecentBlockhash("max")
  ).blockhash;
  useFirstTx.sign(useAuthorityKeypair);
  const useFirstTxid = await sendAndConfirmRawTransaction(
    connection,
    useFirstTx.serialize()
  );
  console.log(`4. Use succesfully ${useFirstTxid}\n`);

  //////////////////////// REMOVE DELEGATE ////////////////////////
  const removeDelegateTx = new Transaction();
  console.log("Removing token delegate... ", tokenCreator.publicKey.toString());
  removeDelegateTx.add(
    splToken.Token.createRevokeInstruction(
      splToken.TOKEN_PROGRAM_ID,
      tokenAccountId,
      tokenCreator.publicKey,
      []
    )
  );
  removeDelegateTx.feePayer = tokenCreator.publicKey;
  removeDelegateTx.recentBlockhash = (
    await connection.getRecentBlockhash("max")
  ).blockhash;
  removeDelegateTx.sign(tokenCreator);
  const removeDelegateTxid = await sendAndConfirmRawTransaction(
    connection,
    removeDelegateTx.serialize()
  );
  console.log(
    `5. Delegate revoked for user (${useAuthorityKeypair.publicKey.toString()}) and token account (${tokenAccountId}) txid (${removeDelegateTxid})\n`
  );
  const tokenAccountInfo2 = await splTokenMint.getAccountInfo(tokenAccountId);
  console.log("Delegate after: ", tokenAccountInfo2.delegate?.toString());

  //////////////////////// USE AUTHORITY ATTEMPT TO USE ////////////////////////
  console.log("Use authority attempt to use... ");
  const useTx = new Transaction();
  useTx.add(
    createUtilizeInstruction(
      {
        metadata: metadataId,
        tokenAccount: tokenAccountId,
        mint: tokenKeypair.publicKey,
        useAuthority: useAuthorityKeypair.publicKey,
        owner: tokenCreator.publicKey,
        useAuthorityRecord: useAuthorityRecordId,
        burner: burnerId,
      },
      {
        utilizeArgs: { numberOfUses: 1 },
      }
    )
  );
  useTx.feePayer = useAuthorityKeypair.publicKey;
  useTx.recentBlockhash = (
    await connection.getRecentBlockhash("max")
  ).blockhash;
  useTx.sign(useAuthorityKeypair);
  const useTxid = await sendAndConfirmRawTransaction(
    connection,
    useTx.serialize()
  );
  console.log(`6. Use failed because it cannot be burned ${useTxid}\n`);

  return useTxid;
}

main();
