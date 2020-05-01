pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/lifecycle/Destructible.sol";
import "openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";


contract Freyr is Ownable, Pausable, Destructible {
    using SafeMath for uint256;

    // Struct of a freyr document
    // A freyr document is identified by its data hash, which is
    // keccak256(data + optional nonce)
    struct Document {
        // owner of the document
        address owner;
        // hash of the plaintext metadata
        bytes32 metadataHash;
        // attester signatures
        mapping(address => bool) sigs;
        // count of attester sigs
        uint256 sigCount;
        // ipfs path of the encrypted data
        string dataUri;
        // timestamp of the block when the document is added
        uint256 timestamp;
    }

    event FreyrDocumentAdded(
        bytes32 indexed dataHash,
        address indexed owner,
        string metadata
    );

    event FreyrDocumentSigAdded(
        bytes32 indexed dataHash,
        address indexed attester
    );

    // all freyr documents
    // dataHash => document mapping
    mapping(bytes32 => Document) public documents;

    /* Constructor */
    constructor() public {}

    /* Fallback function */
    function() public {}

    /* External functions */

    function addDocumentByAdmin(
        bytes32 dataHash,
        address owner,
        address attester,
        string metadata,
        string dataUri
    ) external onlyOwner whenNotPaused returns (bool) {
        require(_addDocument(dataHash, owner, metadata, dataUri) == true);
        if (attester != address(0)) {
            require(_addSig(dataHash, attester));
        }
        return true;
    }

    /* Public functions */

    /// Add a document by user without any provider's signatures.
    /// @param dataHash the hash of the data
    /// @param metadata plaintext metadata for the document
    /// @param dataUri the ipfs path of the encrypted data
    function addDocument(bytes32 dataHash, string metadata, string dataUri)
        public
        whenNotPaused
        returns (bool)
    {
        require(_addDocument(dataHash, msg.sender, metadata, dataUri) == true);
        require(_addSig(dataHash, msg.sender));
        return true;
    }

    /// Add a provider's signature to a freyr document
    /// i.e. adding an attestation
    /// This function can be called by anyone. As long as the signatures are
    /// indeed from a provider, the sig will be added to the document.
    /// The signature should cover the root hash, which is
    /// hash(hash(data), hash(metadata))
    /// @param dataHash the data hash of a freyr document
    /// @param r signature: R
    /// @param s signature: S
    /// @param v signature: V
    function addSig(bytes32 dataHash, bytes32 r, bytes32 s, uint8 v)
        public
        whenNotPaused
        returns (bool)
    {
        // find the root hash of the document
        bytes32 rootHash = rootHashOf(dataHash);
        // recover the provider's address from signature
        address provider = recover(rootHash, r, s, v);
        // add sig
        require(_addSig(dataHash, provider));
        return true;
    }

    function recover(bytes32 message, bytes32 r, bytes32 s, uint8 v)
        public
        pure
        returns (address)
    {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, message));
        return ecrecover(prefixedHash, v, r, s);
    }

    function documentOwnerOf(bytes32 dataHash) public view returns (address) {
        return documents[dataHash].owner;
    }

    function rootHashOf(bytes32 dataHash) public view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(dataHash, documents[dataHash].metadataHash)
            );
    }

    function sigExists(bytes32 dataHash, address provider)
        public
        view
        returns (bool)
    {
        return documents[dataHash].sigs[provider];
    }

    /* Internal functions */

    function _addDocument(
        bytes32 dataHash,
        address owner,
        string metadata,
        string dataUri
    ) internal returns (bool) {
        // validate input
        require(dataHash != 0);
        require(bytes(dataUri).length != 0);
        bytes32 metadataHash = keccak256(abi.encodePacked(metadata));

        // the file must be new
        require(documents[dataHash].timestamp == 0);

        // add document
        documents[dataHash] = Document({
            owner: owner,
            metadataHash: metadataHash,
            sigCount: 0,
            dataUri: dataUri, // solium-disable-next-line security/no-block-members
            timestamp: block.timestamp
        });
        // emit event
        emit FreyrDocumentAdded(dataHash, owner, metadata);
        return true;
    }

    function _addSig(bytes32 dataHash, address provider)
        internal
        returns (bool)
    {
        Document storage document = documents[dataHash];
        // the file must exist
        require(document.timestamp != 0);
        // the provider must not have signed the file already
        require(!document.sigs[provider]);
        // add signature
        document.sigCount = document.sigCount.add(1);
        document.sigs[provider] = true;
        // emit event
        emit FreyrDocumentSigAdded(dataHash, provider);
        return true;
    }
}
