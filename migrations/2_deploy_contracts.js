const StowRecords = artifacts.require("./StowRecords.sol");

module.exports = deployer => {
  deployer.deploy(StowRecords);
};
