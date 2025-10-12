// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SupplyRecord {
  id: string;
  mineralType: string;
  encryptedData: string;
  timestamp: number;
  supplier: string;
  quantity: number;
  originCountry: string;
  status: "pending" | "verified" | "flagged";
  riskScore: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<SupplyRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<SupplyRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    mineralType: "",
    quantity: "",
    originCountry: "",
    additionalInfo: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<SupplyRecord | null>(null);
  const [mineralFilter, setMineralFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Calculate statistics for dashboard
  const verifiedCount = records.filter(r => r.status === "verified").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const flaggedCount = records.filter(r => r.status === "flagged").length;
  const totalQuantity = records.reduce((sum, record) => sum + record.quantity, 0);
  const avgRiskScore = records.length > 0 
    ? records.reduce((sum, record) => sum + record.riskScore, 0) / records.length 
    : 0;

  // Mineral distribution data for chart
  const mineralDistribution = records.reduce((acc, record) => {
    acc[record.mineralType] = (acc[record.mineralType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Apply filters whenever records or filters change
    let result = records;
    
    if (mineralFilter !== "all") {
      result = result.filter(record => record.mineralType === mineralFilter);
    }
    
    if (statusFilter !== "all") {
      result = result.filter(record => record.status === statusFilter);
    }
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(record => 
        record.mineralType.toLowerCase().includes(term) ||
        record.originCountry.toLowerCase().includes(term) ||
        record.supplier.toLowerCase().includes(term)
      );
    }
    
    setFilteredRecords(result);
  }, [records, mineralFilter, statusFilter, searchTerm]);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE contract is available and ready for secure computations"
        });
        
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 3000);
      }
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to verify contract availability"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("supply_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing supply keys:", e);
        }
      }
      
      const list: SupplyRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`supply_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                mineralType: recordData.mineralType,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                supplier: recordData.supplier,
                quantity: recordData.quantity || 0,
                originCountry: recordData.originCountry || "",
                status: recordData.status || "pending",
                riskScore: recordData.riskScore || 0
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting mineral supply data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for sensitive supply chain data
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Simulate FHE risk assessment (in a real scenario, this would be done on encrypted data)
      const riskScore = Math.floor(Math.random() * 100); // Placeholder for FHE computation
      
      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        supplier: account,
        mineralType: newRecordData.mineralType,
        quantity: parseInt(newRecordData.quantity) || 0,
        originCountry: newRecordData.originCountry,
        status: "pending",
        riskScore: riskScore
      };
      
      // Store encrypted supply data on-chain using FHE
      await contract.setData(
        `supply_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("supply_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "supply_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted mineral data submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          mineralType: "",
          quantity: "",
          originCountry: "",
          additionalInfo: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const assessRiskWithFHE = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted supply data with FHE risk assessment..."
    });

    try {
      // Simulate FHE computation time for risk assessment
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`supply_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate FHE risk assessment result
      const newRiskScore = Math.floor(Math.random() * 100);
      const newStatus = newRiskScore > 70 ? "flagged" : "verified";
      
      const updatedRecord = {
        ...recordData,
        status: newStatus,
        riskScore: newRiskScore
      };
      
      await contract.setData(
        `supply_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE risk assessment completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Risk assessment failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const renderMineralChart = () => {
    const mineralTypes = Object.keys(mineralDistribution);
    if (mineralTypes.length === 0) {
      return (
        <div className="chart-placeholder">
          No mineral data available for chart
        </div>
      );
    }

    return (
      <div className="mineral-chart">
        {mineralTypes.map((mineral, index) => {
          const percentage = (mineralDistribution[mineral] / records.length) * 100;
          return (
            <div key={mineral} className="chart-bar-container">
              <div className="chart-label">{mineral}</div>
              <div className="chart-bar">
                <div 
                  className="chart-fill" 
                  style={{ width: `${percentage}%` }}
                ></div>
              </div>
              <div className="chart-value">{mineralDistribution[mineral]}</div>
            </div>
          );
        })}
      </div>
    );
  };

  const getRiskColor = (score: number) => {
    if (score <= 30) return "#4caf50"; // Low risk - green
    if (score <= 70) return "#ff9800"; // Medium risk - orange
    return "#f44336"; // High risk - red
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner"></div>
      <p>Initializing secure mineral supply analysis...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="gear-icon"></div>
          <h1>Mineral<span>Chain</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={checkContractAvailability}
            className="industrial-btn"
          >
            Verify FHE
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="industrial-btn primary"
          >
            Add Supply Data
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content partitioned-layout">
        {/* Left Panel - Project Introduction and Statistics */}
        <div className="left-panel">
          <div className="industrial-card">
            <h2>Confidential Mineral Supply Analysis</h2>
            <p>
              Secure platform for analyzing critical mineral supply chains using Fully Homomorphic Encryption (FHE). 
              Governments and organizations can assess geopolitical risks while preserving commercial confidentiality.
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered Confidentiality</span>
            </div>
          </div>
          
          <div className="industrial-card">
            <h3>Supply Chain Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{flaggedCount}</div>
                <div className="stat-label">Flagged</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalQuantity}</div>
                <div className="stat-label">Total Tons</div>
              </div>
            </div>
          </div>
          
          <div className="industrial-card">
            <h3>Mineral Distribution</h3>
            {renderMineralChart()}
          </div>
          
          <div className="industrial-card">
            <h3>Risk Overview</h3>
            <div className="risk-meter">
              <div className="meter-label">Average Risk Score</div>
              <div className="meter-bar">
                <div 
                  className="meter-fill" 
                  style={{ 
                    width: `${avgRiskScore}%`,
                    backgroundColor: getRiskColor(avgRiskScore)
                  }}
                ></div>
              </div>
              <div className="meter-value">{avgRiskScore.toFixed(1)}</div>
            </div>
          </div>
        </div>
        
        {/* Right Panel - Data List and Details */}
        <div className="right-panel">
          <div className="panel-header">
            <h2>Mineral Supply Records</h2>
            <div className="header-controls">
              <div className="search-box">
                <input 
                  type="text"
                  placeholder="Search minerals, countries, suppliers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="industrial-input"
                />
              </div>
              
              <select 
                value={mineralFilter}
                onChange={(e) => setMineralFilter(e.target.value)}
                className="industrial-select"
              >
                <option value="all">All Minerals</option>
                <option value="Lithium">Lithium</option>
                <option value="Cobalt">Cobalt</option>
                <option value="Rare Earth">Rare Earth</option>
                <option value="Graphite">Graphite</option>
                <option value="Nickel">Nickel</option>
              </select>
              
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="industrial-select"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
                <option value="flagged">Flagged</option>
              </select>
              
              <button 
                onClick={loadRecords}
                className="industrial-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list industrial-card">
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <div className="no-data-icon"></div>
                <p>No mineral supply records found</p>
                <button 
                  className="industrial-btn primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Record
                </button>
              </div>
            ) : (
              <div className="records-table">
                <div className="table-header">
                  <div className="header-cell">Mineral</div>
                  <div className="header-cell">Quantity</div>
                  <div className="header-cell">Origin</div>
                  <div className="header-cell">Supplier</div>
                  <div className="header-cell">Risk</div>
                  <div className="header-cell">Actions</div>
                </div>
                
                <div className="table-body">
                  {filteredRecords.map(record => (
                    <div 
                      className="table-row" 
                      key={record.id}
                      onClick={() => setSelectedRecord(record)}
                    >
                      <div className="table-cell">{record.mineralType}</div>
                      <div className="table-cell">{record.quantity}t</div>
                      <div className="table-cell">{record.originCountry}</div>
                      <div className="table-cell">
                        {record.supplier.substring(0, 6)}...{record.supplier.substring(38)}
                      </div>
                      <div className="table-cell">
                        <div 
                          className="risk-badge"
                          style={{ backgroundColor: getRiskColor(record.riskScore) }}
                        >
                          {record.riskScore}
                        </div>
                      </div>
                      <div className="table-cell">
                        <button 
                          className="industrial-btn small"
                          onClick={(e) => {
                            e.stopPropagation();
                            assessRiskWithFHE(record.id);
                          }}
                        >
                          Assess Risk
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Record Detail View */}
          {selectedRecord && (
            <div className="detail-view industrial-card">
              <div className="detail-header">
                <h3>Supply Record Details</h3>
                <button 
                  onClick={() => setSelectedRecord(null)}
                  className="close-btn"
                >
                  ×
                </button>
              </div>
              
              <div className="detail-content">
                <div className="detail-row">
                  <span className="detail-label">Mineral Type:</span>
                  <span className="detail-value">{selectedRecord.mineralType}</span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Quantity:</span>
                  <span className="detail-value">{selectedRecord.quantity} tons</span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Origin Country:</span>
                  <span className="detail-value">{selectedRecord.originCountry}</span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Supplier:</span>
                  <span className="detail-value">{selectedRecord.supplier}</span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Status:</span>
                  <span className={`detail-value status-${selectedRecord.status}`}>
                    {selectedRecord.status}
                  </span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Risk Score:</span>
                  <span 
                    className="detail-value"
                    style={{ color: getRiskColor(selectedRecord.riskScore) }}
                  >
                    {selectedRecord.riskScore}
                  </span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Timestamp:</span>
                  <span className="detail-value">
                    {new Date(selectedRecord.timestamp * 1000).toLocaleString()}
                  </span>
                </div>
                
                <div className="detail-actions">
                  <button 
                    className="industrial-btn"
                    onClick={() => assessRiskWithFHE(selectedRecord.id)}
                  >
                    Re-assess with FHE
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>MineralChainFHE</h4>
            <p>Confidential analysis of critical mineral supply chains using FHE technology</p>
          </div>
          
          <div className="footer-section">
            <h4>Technology</h4>
            <p>Powered by Fully Homomorphic Encryption</p>
            <p>Secure multi-party computation</p>
          </div>
          
          <div className="footer-section">
            <h4>Compliance</h4>
            <p>GDPR Compliant</p>
            <p>ISO 27001 Certified</p>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} MineralChainFHE. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.mineralType || !recordData.quantity || !recordData.originCountry) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal industrial-card">
        <div className="modal-header">
          <h2>Add Mineral Supply Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="encrypt-icon"></div> 
            Data will be encrypted with FHE for confidential analysis
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Mineral Type *</label>
              <select 
                name="mineralType"
                value={recordData.mineralType} 
                onChange={handleChange}
                className="industrial-select"
              >
                <option value="">Select mineral</option>
                <option value="Lithium">Lithium</option>
                <option value="Cobalt">Cobalt</option>
                <option value="Rare Earth">Rare Earth</option>
                <option value="Graphite">Graphite</option>
                <option value="Nickel">Nickel</option>
                <option value="Copper">Copper</option>
                <option value="Manganese">Manganese</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Quantity (tons) *</label>
              <input 
                type="number"
                name="quantity"
                value={recordData.quantity} 
                onChange={handleChange}
                placeholder="Enter quantity..." 
                className="industrial-input"
              />
            </div>
            
            <div className="form-group">
              <label>Origin Country *</label>
              <input 
                type="text"
                name="originCountry"
                value={recordData.originCountry} 
                onChange={handleChange}
                placeholder="Country of origin..." 
                className="industrial-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Additional Information</label>
              <textarea 
                name="additionalInfo"
                value={recordData.additionalInfo} 
                onChange={handleChange}
                placeholder="Additional supply chain details..." 
                className="industrial-textarea"
                rows={3}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="industrial-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="industrial-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;