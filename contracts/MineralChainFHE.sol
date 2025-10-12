// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MineralChainFHE is SepoliaConfig {
    struct EncryptedSupplyData {
        uint256 id;
        euint32 encryptedMineralType;
        euint32 encryptedQuantity;
        euint32 encryptedOrigin;
        uint256 timestamp;
    }
    
    struct DecryptedSupplyData {
        string mineralType;
        uint256 quantity;
        string origin;
        bool isAnalyzed;
    }

    uint256 public dataCount;
    mapping(uint256 => EncryptedSupplyData) public encryptedSupplyData;
    mapping(uint256 => DecryptedSupplyData) public decryptedSupplyData;
    
    mapping(string => euint32) private encryptedMineralStats;
    string[] private mineralTypeList;
    
    mapping(uint256 => uint256) private requestToDataId;
    
    event DataSubmitted(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed id);
    event DataAnalyzed(uint256 indexed id);
    
    modifier onlyAuthorized(uint256 dataId) {
        _;
    }
    
    function submitEncryptedSupplyData(
        euint32 encryptedMineralType,
        euint32 encryptedQuantity,
        euint32 encryptedOrigin
    ) public {
        dataCount += 1;
        uint256 newId = dataCount;
        
        encryptedSupplyData[newId] = EncryptedSupplyData({
            id: newId,
            encryptedMineralType: encryptedMineralType,
            encryptedQuantity: encryptedQuantity,
            encryptedOrigin: encryptedOrigin,
            timestamp: block.timestamp
        });
        
        decryptedSupplyData[newId] = DecryptedSupplyData({
            mineralType: "",
            quantity: 0,
            origin: "",
            isAnalyzed: false
        });
        
        emit DataSubmitted(newId, block.timestamp);
    }
    
    function requestSupplyAnalysis(uint256 dataId) public onlyAuthorized(dataId) {
        EncryptedSupplyData storage data = encryptedSupplyData[dataId];
        require(!decryptedSupplyData[dataId].isAnalyzed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(data.encryptedMineralType);
        ciphertexts[1] = FHE.toBytes32(data.encryptedQuantity);
        ciphertexts[2] = FHE.toBytes32(data.encryptedOrigin);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.analyzeSupplyChain.selector);
        requestToDataId[reqId] = dataId;
        
        emit AnalysisRequested(dataId);
    }
    
    function analyzeSupplyChain(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");
        
        EncryptedSupplyData storage eData = encryptedSupplyData[dataId];
        DecryptedSupplyData storage dData = decryptedSupplyData[dataId];
        require(!dData.isAnalyzed, "Already analyzed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory mineralType, uint256 quantity, string memory origin) = 
            abi.decode(cleartexts, (string, uint256, string));
        
        dData.mineralType = mineralType;
        dData.quantity = quantity;
        dData.origin = origin;
        dData.isAnalyzed = true;
        
        if (FHE.isInitialized(encryptedMineralStats[dData.mineralType]) == false) {
            encryptedMineralStats[dData.mineralType] = FHE.asEuint32(0);
            mineralTypeList.push(dData.mineralType);
        }
        encryptedMineralStats[dData.mineralType] = FHE.add(
            encryptedMineralStats[dData.mineralType], 
            FHE.asEuint32(1)
        );
        
        emit DataAnalyzed(dataId);
    }
    
    function getDecryptedSupplyData(uint256 dataId) public view returns (
        string memory mineralType,
        uint256 quantity,
        string memory origin,
        bool isAnalyzed
    ) {
        DecryptedSupplyData storage d = decryptedSupplyData[dataId];
        return (d.mineralType, d.quantity, d.origin, d.isAnalyzed);
    }
    
    function getEncryptedMineralStats(string memory mineralType) public view returns (euint32) {
        return encryptedMineralStats[mineralType];
    }
    
    function requestMineralStatsDecryption(string memory mineralType) public {
        euint32 stats = encryptedMineralStats[mineralType];
        require(FHE.isInitialized(stats), "Mineral type not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMineralStats.selector);
        requestToDataId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(mineralType)));
    }
    
    function decryptMineralStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 mineralHash = requestToDataId[requestId];
        string memory mineralType = getMineralTypeFromHash(mineralHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getMineralTypeFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < mineralTypeList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(mineralTypeList[i]))) == hash) {
                return mineralTypeList[i];
            }
        }
        revert("Mineral type not found");
    }
    
    function calculateSupplyRisk(
        string memory mineralType,
        string[] memory highRiskRegions
    ) public view returns (uint256 riskScore) {
        uint256 totalQuantity = 0;
        uint256 highRiskQuantity = 0;
        
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedSupplyData[i].isAnalyzed && 
                keccak256(abi.encodePacked(decryptedSupplyData[i].mineralType)) == keccak256(abi.encodePacked(mineralType))) {
                totalQuantity += decryptedSupplyData[i].quantity;
                
                for (uint256 j = 0; j < highRiskRegions.length; j++) {
                    if (keccak256(abi.encodePacked(decryptedSupplyData[i].origin)) == keccak256(abi.encodePacked(highRiskRegions[j]))) {
                        highRiskQuantity += decryptedSupplyData[i].quantity;
                        break;
                    }
                }
            }
        }
        
        return totalQuantity > 0 ? (highRiskQuantity * 100) / totalQuantity : 0;
    }
    
    function getCriticalMineralSummary() public view returns (string[] memory minerals, uint256[] memory totalQuantities) {
        minerals = new string[](mineralTypeList.length);
        totalQuantities = new uint256[](mineralTypeList.length);
        
        for (uint256 i = 0; i < mineralTypeList.length; i++) {
            minerals[i] = mineralTypeList[i];
            for (uint256 j = 1; j <= dataCount; j++) {
                if (decryptedSupplyData[j].isAnalyzed && 
                    keccak256(abi.encodePacked(decryptedSupplyData[j].mineralType)) == keccak256(abi.encodePacked(mineralTypeList[i]))) {
                    totalQuantities[i] += decryptedSupplyData[j].quantity;
                }
            }
        }
        return (minerals, totalQuantities);
    }
}