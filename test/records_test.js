import assertRevert from 'openzeppelin-solidity/test/helpers/assertRevert';

const Freyr = artifacts.require('./Freyr.sol');

const crypto = require('crypto');
const eutil = require('ethereumjs-util');

const testDataContent = '{"foo":"bar","baz":42}';
// 0x276bc9ec8730ad53e827c0467c00473a53337e2cb4b61ada24760a217fb1ef14
const testDataHash = eutil.bufferToHex(eutil.sha3(testDataContent));
const testDataUri = 'QmUMqi1rr4Ad1eZ3ctsRUEmqK2U3CyZqpetUe51LB9GiAM';
const testMetadata = 'KEYWORDS';
const testMetaHash = eutil.bufferToHex(eutil.sha3(testMetadata));
const testRootHash = eutil.bufferToHex(
  eutil.sha3(
    Buffer.concat([eutil.sha3(testDataContent), eutil.sha3(testMetadata)])
  )
);

contract('Freyr', (accounts) => {
  const admin = accounts[0];
  const user = accounts[1];
  const provider1 = accounts[2];
  const provider2 = accounts[3];
  const nonUser = accounts[4];
  let instance;

  beforeEach('deploy a new Freyr contract', async () => {
    instance = await Freyr.new();
  });
  describe('recover', () => {
    it('should recover the signer address if sig is valid', async () => {
      const msgHash = eutil.bufferToHex(eutil.sha3(crypto.randomBytes(2000)));
      const rsv = eutil.fromRpcSig(web3.eth.sign(provider1, msgHash));
      const recoveredAddr = await instance.recover(
        msgHash,
        eutil.bufferToHex(rsv.r),
        eutil.bufferToHex(rsv.s),
        rsv.v
      );
      assert.equal(recoveredAddr, provider1);
    });
    it('should recover zero address if sig is bad', async () => {
      const msgHash = eutil.bufferToHex(eutil.sha3(crypto.randomBytes(2000)));
      const recoveredAddr = await instance.recover(
        msgHash,
        eutil.bufferToHex(Buffer.from(new Uint32Array(64))),
        eutil.bufferToHex(Buffer.from(new Uint32Array(64))),
        27
      );
      assert.equal(recoveredAddr, 0);
    });
  });
  describe('add document by user', () => {
    it('should allow a user to add a document', async () => {
      const tx = await instance.addDocument(
        testDataHash,
        testMetadata,
        testDataUri,
        { from: user }
      );
      assert.equal(tx.logs.length, 2);
      assert.equal(tx.logs[0].event, 'FreyrDocumentAdded');
      assert.equal(tx.logs[0].args.dataHash, testDataHash);
      assert.equal(tx.logs[0].args.owner, user);
      assert.equal(tx.logs[0].args.metadata, testMetadata);
      const { timestamp } = web3.eth.getBlock(tx.receipt.blockNumber);
      // check state
      const storedDocument = await instance.documents(testDataHash);
      assert.equal(storedDocument[0], user);
      assert.equal(storedDocument[1], testMetaHash);
      assert.equal(storedDocument[2], 1); // sig count
      assert.equal(storedDocument[3], testDataUri);
      assert.equal(storedDocument[4], timestamp);
    });
    it('should not allow user to add same document twice', async () => {
      await instance.addDocument(testDataHash, testMetadata, testDataUri, {
        from: user,
      });
      // try submitting the file again
      await assertRevert(
        instance.addDocument(testDataHash, testMetadata, testDataUri, {
          from: user,
        })
      );
    });
    it('should reject if data hash or data uri is zero', async () => {
      // try zero data hash
      await assertRevert(
        instance.addDocument(0, testMetadata, testDataUri, {
          from: user,
        })
      );
      // try zero data uri
      await assertRevert(
        instance.addDocument(testDataHash, testMetadata, 0, {
          from: user,
        })
      );
    });
    it('should allow a long dataUri', async () => {
      const testLongDataUri = eutil.bufferToHex(
        'https://www.centralService.com/cloud/storage/v1/b/example-bucket/o/foo%2f%3fbar'
      );
      const tx = await instance.addDocument(
        testDataHash,
        testMetadata,
        testLongDataUri,
        { from: user }
      );
      assert.equal(tx.logs.length, 2);
      // check state
      const storedDocument = await instance.documents(testDataHash);
      assert.equal(storedDocument[3], testLongDataUri);
    });
  });

  describe('add signature', () => {
    it('should allow adding valid signature', async () => {
      // add a file without any sig, by user
      await instance.addDocument(testDataHash, testMetadata, testDataUri, {
        from: user,
      });
      // have provider1 sign the root hash
      const rsv = eutil.fromRpcSig(web3.eth.sign(provider1, testRootHash));
      // anyone should be able to submit the signature
      const tx = await instance.addSig(
        testDataHash,
        eutil.bufferToHex(rsv.r),
        eutil.bufferToHex(rsv.s),
        rsv.v,
        { from: nonUser }
      );
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, 'FreyrDocumentSigAdded');
      assert.equal(tx.logs[0].args.dataHash, testDataHash);
      assert.equal(tx.logs[0].args.attester, provider1);
      // check state
      const storedDocument = await instance.documents(testDataHash);
      assert.equal(storedDocument[2], 2); // sig count
      assert.equal(await instance.sigExists(testDataHash, provider1), true);
    });
    it('should not allow adding the same sig twice', async () => {
      // add a file without any sig
      await instance.addDocument(testDataHash, testMetadata, testDataUri, {
        from: user,
      });
      // have provider1 sign it
      const rsv = eutil.fromRpcSig(web3.eth.sign(provider1, testRootHash));
      await instance.addSig(
        testDataHash,
        eutil.bufferToHex(rsv.r),
        eutil.bufferToHex(rsv.s),
        rsv.v,
        { from: nonUser }
      );
      await assertRevert(
        instance.addSig(
          testDataHash,
          eutil.bufferToHex(rsv.r),
          eutil.bufferToHex(rsv.s),
          rsv.v,
          { from: nonUser }
        )
      );
    });
    it('should allow adding sigs from different providers', async () => {
      await instance.addDocument(testDataHash, testMetadata, testDataUri, {
        from: user,
      });
      // have provider1 sign it
      const rsv1 = eutil.fromRpcSig(web3.eth.sign(provider1, testRootHash));
      const tx1 = await instance.addSig(
        testDataHash,
        eutil.bufferToHex(rsv1.r),
        eutil.bufferToHex(rsv1.s),
        rsv1.v,
        { from: nonUser }
      );
      // check log
      assert.equal(tx1.logs.length, 1);
      assert.equal(tx1.logs[0].event, 'FreyrDocumentSigAdded');
      assert.equal(tx1.logs[0].args.dataHash, testDataHash);
      assert.equal(tx1.logs[0].args.attester, provider1);
      // have provider2 sign it
      const rsv2 = eutil.fromRpcSig(web3.eth.sign(provider2, testRootHash));
      const tx2 = await instance.addSig(
        testDataHash,
        eutil.bufferToHex(rsv2.r),
        eutil.bufferToHex(rsv2.s),
        rsv2.v,
        { from: nonUser }
      );
      // check log
      assert.equal(tx2.logs.length, 1);
      assert.equal(tx2.logs[0].event, 'FreyrDocumentSigAdded');
      assert.equal(tx2.logs[0].args.dataHash, testDataHash);
      assert.equal(tx2.logs[0].args.attester, provider2);
      // check state
      const storedDocument = await instance.documents(testDataHash);
      assert.equal(storedDocument[2], 3); // sig count
      assert.equal(await instance.sigExists(testDataHash, provider1), true);
      assert.equal(await instance.sigExists(testDataHash, provider2), true);
    });
    it('should allow adding another sig after provider added file', async () => {
      await instance.addDocument(testDataHash, testMetadata, testDataUri, {
        from: provider1,
      });
      // now have provider2 sign it
      const rsv2 = eutil.fromRpcSig(web3.eth.sign(provider2, testRootHash));
      const tx = await instance.addSig(
        testDataHash,
        eutil.bufferToHex(rsv2.r),
        eutil.bufferToHex(rsv2.s),
        rsv2.v,
        { from: nonUser }
      );
      assert.equal(tx.logs[0].event, 'FreyrDocumentSigAdded');
      assert.equal(tx.logs[0].args.dataHash, testDataHash);
      assert.equal(tx.logs[0].args.attester, provider2);
      // check state
      const storedDocument = await instance.documents(testDataHash);
      assert.equal(storedDocument[2], 2); // sig count
      assert.equal(await instance.sigExists(testDataHash, provider1), true);
      assert.equal(await instance.sigExists(testDataHash, provider2), true);
    });
    // it("should reject bad signatures", async () => {
    //   await instance.addDocument(testDataHash, testMetadata, testDataUri, {
    //     from: user
    //   });
    //   const rsv = eutil.fromRpcSig(web3.eth.sign(provider1, testRootHash));
    //   // flip S and V
    //   await assertRevert(
    //     instance.addSig(
    //       testDataHash,
    //       eutil.bufferToHex(rsv.s),
    //       eutil.bufferToHex(rsv.v),
    //       rsv.v,
    //       { from: user }
    //     )
    //   );
    // });
    // it("should reject sig that doesn't cover metadata hash", async () => {
    //   await instance.addDocument(testDataHash, testMetadata, testDataUri, {
    //     from: user
    //   });
    //   // sign the data hash instead of root hash
    //   const rsv = eutil.fromRpcSig(web3.eth.sign(provider1, testDataHash));
    //   await assertRevert(
    //     instance.addSig(
    //       testDataHash,
    //       eutil.bufferToHex(rsv.r),
    //       eutil.bufferToHex(rsv.s),
    //       rsv.v,
    //       { from: user }
    //     )
    //   );
    // });
  });
  describe('add document by admin', () => {
    it('should allow admin to add a document without attestation', async () => {
      const tx = await instance.addDocumentByAdmin(
        testDataHash,
        user,
        0,
        testMetadata,
        testDataUri,
        { from: admin }
      );
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, 'FreyrDocumentAdded');
      assert.equal(tx.logs[0].args.dataHash, testDataHash);
      assert.equal(tx.logs[0].args.owner, user);
      assert.equal(tx.logs[0].args.metadata, testMetadata);
      // check state
      const { timestamp } = web3.eth.getBlock(tx.receipt.blockNumber);
      const storedDocument = await instance.documents(testDataHash);
      assert.equal(storedDocument[0], user);
      assert.equal(storedDocument[1], testMetaHash);
      assert.equal(storedDocument[2], 0); // sig count
      assert.equal(storedDocument[3], testDataUri);
      assert.equal(storedDocument[4], timestamp);
    });
    it('should allow admin to add a document with attestation', async () => {
      const tx = await instance.addDocumentByAdmin(
        testDataHash,
        user,
        provider1,
        testMetadata,
        testDataUri,
        { from: admin }
      );
      assert.equal(tx.logs.length, 2);
      assert.equal(tx.logs[0].event, 'FreyrDocumentAdded');
      assert.equal(tx.logs[0].args.dataHash, testDataHash);
      assert.equal(tx.logs[0].args.owner, user);
      assert.equal(tx.logs[0].args.metadata, testMetadata);
      assert.equal(tx.logs[1].event, 'FreyrDocumentSigAdded');
      assert.equal(tx.logs[1].args.dataHash, testDataHash);
      assert.equal(tx.logs[1].args.attester, provider1);
      // check state
      const { timestamp } = web3.eth.getBlock(tx.receipt.blockNumber);
      const storedDocument = await instance.documents(testDataHash);
      assert.equal(storedDocument[0], user);
      assert.equal(storedDocument[1], testMetaHash);
      assert.equal(storedDocument[2], 1); // sig count
      assert.equal(storedDocument[3], testDataUri);
      assert.equal(storedDocument[4], timestamp);
      assert.equal(await instance.sigExists(testDataHash, provider1), true);
    });
    it('should not allow non admin to call', async () => {
      await assertRevert(
        instance.addDocumentByAdmin(
          testDataHash,
          user,
          provider1,
          testMetadata,
          testDataUri,
          { from: provider1 }
        )
      );
      await assertRevert(
        instance.addDocumentByAdmin(
          testDataHash,
          user,
          0,
          testMetadata,
          testDataUri,
          { from: provider1 }
        )
      );
    });
  });
  describe('pausable', () => {
    it('should not allow non-admin to pause or unpause', async () => {
      await assertRevert(instance.pause({ from: accounts[1] }));
      await assertRevert(instance.unpause({ from: accounts[1] }));
    });
    it('should not allow adding documents when paused by admin', async () => {
      const tx = await instance.pause();
      assert.equal(tx.logs[0].event, 'Pause');
      await assertRevert(
        instance.addDocument(testDataHash, testMetadata, testDataUri, {
          from: user,
        })
      );
      const tx2 = await instance.unpause();
      assert.equal(tx2.logs[0].event, 'Unpause');
      const tx3 = await instance.addDocument(
        testDataHash,
        testMetadata,
        testDataUri,
        { from: user }
      );
      assert.equal(tx3.logs[0].event, 'FreyrDocumentAdded');
    });
  });
  // copy paste from documents contract
  describe('destructible', () => {
    it('should not allow non-admin to destroy', async () => {
      await assertRevert(instance.destroy({ from: accounts[1] }));
    });
    // it("should allow admin to destroy", async () => {
    //   assert.notEqual(web3.eth.getCode(instance.address), "0x0");
    //   const tx = await instance.destroy({ from: admin });
    //   assert.equal(tx.logs.length, 0, `did not expect logs but got ${tx.logs}`);
    //   assert.equal(web3.eth.getCode(instance.address), "0x0");
    // });
    // it("should allow admin to destroyAndSend", async () => {
    //   assert.notEqual(web3.eth.getCode(instance.address), "0x0");
    //   const tx = await instance.destroyAndSend(admin, { from: admin });
    //   assert.equal(tx.logs.length, 0, `did not expect logs but got ${tx.logs}`);
    //   assert.equal(web3.eth.getCode(instance.address), "0x0");
    //   assert.equal(web3.eth.getBalance(instance.address).toNumber(), 0);
    // });
  });
});
